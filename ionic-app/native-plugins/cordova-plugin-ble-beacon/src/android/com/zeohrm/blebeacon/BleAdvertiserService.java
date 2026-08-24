package com.zeohrm.blebeacon;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.io.UnsupportedEncodingException;
import java.util.UUID;

/**
 * Foreground Service that keeps BLE advertising alive independently of the
 * WebView / Cordova lifecycle. Started by {@link BleBeaconPlugin} and restarted
 * on boot by {@link BootReceiver}.
 */
public class BleAdvertiserService extends Service {

    public static final String ACTION_START = "com.zeohrm.blebeacon.BLE_START";
    public static final String ACTION_STOP = "com.zeohrm.blebeacon.BLE_STOP";

    public static final String EXTRA_USER_UUID = "userUuid";
    public static final String EXTRA_COMPANY_UUID = "companyServiceUuid";
    public static final String EXTRA_USER_NAME = "userName";

    private static final String CHANNEL_ID = "ble_beacon_channel";
    private static final int NOTIFICATION_ID = 1002;
    private static final String WARNING_CHANNEL_ID = "ble_beacon_warning_channel";
    private static final int WARNING_NOTIFICATION_ID = 1003;
    private static final int ADVERTISING_FAILED_NOTIFICATION_ID = 1006;
    private static final String TAG = "BleAdvertiserService";

    // Retry-with-backoff for onStartFailure() — attendance tracking depends on this
    // actually broadcasting, so a rejected advertise call (e.g. TOO_MANY_ADVERTISERS,
    // a device-wide BLE hardware limit shared across every app) keeps retrying
    // indefinitely rather than giving up after logging/notifying once. Backoff caps
    // at RETRY_BACKOFF_CAP_MS so a persistent failure doesn't hammer the radio, but
    // never stops on its own — only stopAdvertising() (checkout/mode switch) cancels it.
    private static final long[] RETRY_BACKOFF_MS = {5_000, 10_000, 20_000, 30_000};
    private static final long RETRY_BACKOFF_CAP_MS = 60_000;
    // Only notify once retrying has clearly failed to self-resolve quickly, not on
    // every attempt — the retry loop handles the common transient case silently.
    private static final int NOTIFY_AFTER_ATTEMPTS = 5;

    private BluetoothLeAdvertiser advertiser;
    private AdvertiseCallback advertiseCallback;
    private BroadcastReceiver bluetoothStateReceiver;
    private Handler retryHandler;
    private Runnable pendingRetry;
    private int retryAttempt = 0;
    private String currentUserUuid;
    private String currentCompanyUuid;
    private String currentUserName;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // not a bound service
    }

    @Override
    public void onCreate() {
        super.onCreate();
        retryHandler = new Handler(Looper.getMainLooper());
        createNotificationChannel();
        registerBluetoothStateReceiver();
    }

    /**
     * Toggling Bluetooth off kills the OS-level advertising session outright — this
     * service and its foreground notification keep running regardless (they're not
     * tied to the radio), so nothing else notices. Without this, advertising never
     * resumes when Bluetooth is turned back on: the notification still says "Beacon
     * Active" while the phone silently broadcasts nothing until the user happens to
     * switch modes again. Re-starts advertising automatically using the same
     * last-known identity BootReceiver restores after a device reboot.
     */
    private void registerBluetoothStateReceiver() {
        bluetoothStateReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);

                SharedPreferences prefs = getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE);
                boolean shouldBeAdvertising = prefs.getBoolean(BootReceiver.KEY_ADVERTISING, false);
                if (!shouldBeAdvertising) return;

                if (state == BluetoothAdapter.STATE_ON) {
                    String userUuid = prefs.getString(BootReceiver.KEY_USER_UUID, null);
                    String companyUuid = prefs.getString(BootReceiver.KEY_COMPANY_UUID, null);
                    String userName = prefs.getString(BootReceiver.KEY_USER_NAME, "UNKNOWN");
                    if (userUuid == null || companyUuid == null) return;

                    Log.i(TAG, "Bluetooth re-enabled — resuming advertising for " + userName);
                    retryAttempt = 0; // fresh condition (Bluetooth just came back), not a retry continuation
                    startAdvertising(userUuid, companyUuid, userName);
                } else if (state == BluetoothAdapter.STATE_OFF) {
                    // The persistent "Beacon Active" notification (see buildNotification()) stays
                    // silent/ongoing by design and doesn't surface this — without an explicit alert
                    // here, tracking silently stops with no signal to the user, especially if the
                    // app itself isn't open to catch it via the WebView-side poll.
                    Log.w(TAG, "Bluetooth disabled while advertising was expected to be running");
                    notifyBluetoothDisabled();
                }
            }
        };
        ContextCompat.registerReceiver(
                this,
                bluetoothStateReceiver,
                new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
                ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            // Reached via plain startService() (see BleBeaconPlugin.stopAdvertising) — no
            // startForeground() obligation to fulfil here, and calling it would crash if
            // Bluetooth permissions were never granted (e.g. Field Duty/Remote users, who
            // never request them) just to spin the service up long enough to tear it down.
            stopAdvertising();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String userName = intent != null ? intent.getStringExtra(EXTRA_USER_NAME) : null;
        if (userName == null) userName = "UNKNOWN";

        if (!hasBluetoothPermissions()) {
            // Reached via startForegroundService() (ACTION_START) or an OS-triggered restart
            // with a null intent after Bluetooth permission was revoked mid-session — calling
            // startForeground() with foregroundServiceType="connectedDevice" without this would
            // throw SecurityException and crash the whole app. Bail out cleanly instead.
            Log.e(TAG, "Missing Bluetooth permissions — cannot start as a connectedDevice foreground service");
            stopSelf();
            return START_NOT_STICKY;
        }

        // Must call startForeground() before any further branch or early return — otherwise a
        // call whose obligation lands here while a stop from the previous mode is still in
        // flight (or whose extras are incomplete) leaves that obligation unfulfilled, and
        // Android kills the whole app a few seconds later with ForegroundServiceDidNotStartInTimeException.
        startForeground(NOTIFICATION_ID, buildNotification(userName));

        if (ACTION_START.equals(action)) {
            String userUuid = intent.getStringExtra(EXTRA_USER_UUID);
            String companyUuid = intent.getStringExtra(EXTRA_COMPANY_UUID);

            if (userUuid == null || companyUuid == null) {
                Log.e(TAG, "Missing userUuid/companyUuid — stopping");
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            }

            retryAttempt = 0; // fresh, explicit start (a real check-in) — not a retry continuation
            startAdvertising(userUuid, companyUuid, userName);
        }
        // else: null action (OS restart with no explicit action) — startForeground() above
        // satisfies the foreground obligation; bluetoothStateReceiver/BootReceiver handle
        // actually resuming advertising once Bluetooth/identity are available again.

        // START_STICKY: OS restarts this service (with a null intent) if it's killed.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (bluetoothStateReceiver != null) {
            try {
                unregisterReceiver(bluetoothStateReceiver);
            } catch (IllegalArgumentException e) {
                // already unregistered — harmless
            }
            bluetoothStateReceiver = null;
        }
        stopAdvertising();
        super.onDestroy();
    }

    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADVERTISE)
                        == PackageManager.PERMISSION_GRANTED
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                        == PackageManager.PERMISSION_GRANTED;
        }
        // Pre-Android 12: BLUETOOTH / BLUETOOTH_ADMIN are normal permissions, granted at install time.
        return true;
    }

    // ── BLE advertising ─────────────────────────────────────────────────────

    private void startAdvertising(String userUuidStr, String companyUuidStr, String userName) {
        currentUserUuid = userUuidStr;
        currentCompanyUuid = companyUuidStr;
        currentUserName = userName;
        cancelPendingRetry(); // an explicit (re)start supersedes any retry already queued

        BluetoothManager btManager = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        BluetoothAdapter btAdapter = btManager != null ? btManager.getAdapter() : null;

        if (btAdapter == null || !btAdapter.isEnabled()) {
            Log.e(TAG, "Bluetooth is not available or not enabled");
            return;
        }

        advertiser = btAdapter.getBluetoothLeAdvertiser();
        if (advertiser == null) {
            Log.e(TAG, "Device does not support BLE advertising");
            return;
        }

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY) // ~100ms interval
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
                .setConnectable(false)   // we only broadcast, never connect
                .setTimeout(0)           // advertise indefinitely
                .build();

        ParcelUuid companyUuid = new ParcelUuid(UUID.fromString(companyUuidStr));

        // Primary packet: company service UUID (the scanner filters on this)
        AdvertiseData advertiseData = new AdvertiseData.Builder()
                .addServiceUuid(companyUuid)
                .setIncludeDeviceName(false)
                .setIncludeTxPowerLevel(false)
                .build();

        // Scan-response: employee name as manufacturer data only (fits in 31 bytes)
        byte[] nameBytes;
        try {
            nameBytes = userName.getBytes("UTF-8");
        } catch (UnsupportedEncodingException e) {
            nameBytes = userName.getBytes();
        }

        AdvertiseData scanResponse = new AdvertiseData.Builder()
                .addManufacturerData(0xFFFF, nameBytes)
                .setIncludeDeviceName(false)
                .build();

        final String finalUserName = userName;
        advertiseCallback = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                Log.i(TAG, "BLE advertising started — " + finalUserName);
                retryAttempt = 0; // healthy again — next failure starts backoff from the beginning
            }

            @Override
            public void onStartFailure(int errorCode) {
                String reason = describeError(errorCode);
                Log.e(TAG, "BLE advertising failed: " + reason + " — retrying (attempt " + (retryAttempt + 1) + ")");
                // Distinct from notifyBluetoothDisabled() — this fires when Bluetooth is on
                // and the service is otherwise healthy, but the underlying radio call itself
                // was rejected (e.g. TOO_MANY_ADVERTISERS, a device-wide hardware limit shared
                // across every app using BLE, not something specific to this app). Attendance
                // tracking depends on this actually broadcasting, so this keeps retrying with
                // backoff instead of just logging/notifying once and leaving it dead — the
                // notification only fires once retrying has clearly failed to self-resolve.
                if (retryAttempt + 1 >= NOTIFY_AFTER_ATTEMPTS) {
                    notifyAdvertisingFailed(reason);
                }
                scheduleRetry();
            }
        };

        try {
            advertiser.startAdvertising(settings, advertiseData, scanResponse, advertiseCallback);
        } catch (SecurityException e) {
            Log.e(TAG, "BLUETOOTH_ADVERTISE permission not granted: " + e.getMessage());
        }
    }

    /** Re-invokes startAdvertising() with the same identity after a backoff delay — cancelled
     *  by stopAdvertising() so a queued retry can never fire after the session has ended. */
    private void scheduleRetry() {
        long delay = retryAttempt < RETRY_BACKOFF_MS.length ? RETRY_BACKOFF_MS[retryAttempt] : RETRY_BACKOFF_CAP_MS;
        retryAttempt++;
        cancelPendingRetry();
        pendingRetry = new Runnable() {
            @Override
            public void run() {
                if (currentUserUuid != null && currentCompanyUuid != null) {
                    startAdvertising(currentUserUuid, currentCompanyUuid, currentUserName);
                }
            }
        };
        retryHandler.postDelayed(pendingRetry, delay);
    }

    private void cancelPendingRetry() {
        if (pendingRetry != null) {
            retryHandler.removeCallbacks(pendingRetry);
            pendingRetry = null;
        }
    }

    private void stopAdvertising() {
        // Cancel first — without this, a retry queued from a prior failure could fire after
        // the session has already ended (checkout/mode switch) and incorrectly resume
        // broadcasting for attendance that's no longer active.
        cancelPendingRetry();
        retryAttempt = 0;
        try {
            if (advertiser != null && advertiseCallback != null) {
                advertiser.stopAdvertising(advertiseCallback);
            }
        } catch (Exception e) {
            Log.w(TAG, "stopAdvertising exception: " + e.getMessage());
        }
        advertiser = null;
        advertiseCallback = null;
        Log.i(TAG, "BLE advertising stopped");
    }

    private String describeError(int errorCode) {
        switch (errorCode) {
            case AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE: return "DATA_TOO_LARGE";
            case AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS: return "TOO_MANY_ADVERTISERS";
            case AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED: return "ALREADY_STARTED";
            case AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR: return "INTERNAL_ERROR";
            case AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED: return "FEATURE_UNSUPPORTED";
            default: return "UNKNOWN(" + errorCode + ")";
        }
    }

    // ── Notification ────────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "BLE Beacon", NotificationManager.IMPORTANCE_LOW); // silent, no sound
            channel.setDescription("Shows while broadcasting your presence");

            // Separate, higher-importance channel for the Bluetooth-disabled warning — the
            // channel above is deliberately silent/low-priority, but this warning should
            // actually surface to the user, not blend into the ongoing "beacon active" notification.
            NotificationChannel warningChannel = new NotificationChannel(
                    WARNING_CHANNEL_ID, "Bluetooth Warnings", NotificationManager.IMPORTANCE_DEFAULT);
            warningChannel.setDescription("Alerts when Bluetooth is turned off during Office tracking");

            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
                nm.createNotificationChannel(warningChannel);
            }
        }
    }

    private void notifyBluetoothDisabled() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent != null ? launchIntent : new Intent(),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, WARNING_CHANNEL_ID)
                .setContentTitle("Bluetooth Disabled")
                .setContentText("Bluetooth was turned off — Office attendance tracking has stopped. Please re-enable it.")
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(WARNING_NOTIFICATION_ID, builder.build());
    }

    /** Fired from AdvertiseCallback.onStartFailure() — Bluetooth is on and the service is
     *  otherwise healthy, but the radio itself rejected the advertise request (e.g.
     *  TOO_MANY_ADVERTISERS, a device-wide BLE hardware limit shared across every app,
     *  not something this app can fix on its own). Same channel as the Bluetooth-disabled
     *  warning, distinct notification ID so the two don't overwrite each other. */
    private void notifyAdvertisingFailed(String reason) {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent != null ? launchIntent : new Intent(),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, WARNING_CHANNEL_ID)
                .setContentTitle("Beacon Broadcast Failed")
                .setContentText("Office attendance tracking couldn't start broadcasting (" + reason + "). Try toggling Bluetooth off and on.")
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(ADVERTISING_FAILED_NOTIFICATION_ID, builder.build());
    }

    private Notification buildNotification(String userName) {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent != null ? launchIntent : new Intent(),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Beacon Active — " + userName)
                .setContentText("Broadcasting presence every ~100ms")
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setOngoing(true) // cannot be dismissed by user
                .setContentIntent(pendingIntent)
                .build();
    }
}

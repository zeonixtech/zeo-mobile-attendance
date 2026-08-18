package com.zeohrm.blebeacon;

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
import android.os.Build;
import android.os.IBinder;
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
    private static final String TAG = "BleAdvertiserService";

    private BluetoothLeAdvertiser advertiser;
    private AdvertiseCallback advertiseCallback;
    private BroadcastReceiver bluetoothStateReceiver;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // not a bound service
    }

    @Override
    public void onCreate() {
        super.onCreate();
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
                if (state != BluetoothAdapter.STATE_ON) return;

                SharedPreferences prefs = getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE);
                boolean shouldBeAdvertising = prefs.getBoolean(BootReceiver.KEY_ADVERTISING, false);
                if (!shouldBeAdvertising) return;

                String userUuid = prefs.getString(BootReceiver.KEY_USER_UUID, null);
                String companyUuid = prefs.getString(BootReceiver.KEY_COMPANY_UUID, null);
                String userName = prefs.getString(BootReceiver.KEY_USER_NAME, "UNKNOWN");
                if (userUuid == null || companyUuid == null) return;

                Log.i(TAG, "Bluetooth re-enabled — resuming advertising for " + userName);
                startAdvertising(userUuid, companyUuid, userName);
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
        String userName = intent != null ? intent.getStringExtra(EXTRA_USER_NAME) : null;
        if (userName == null) userName = "UNKNOWN";

        // Must call startForeground() on every entry reached via startForegroundService(),
        // before any branch or early return — otherwise a call whose obligation lands here
        // while a stop from the previous mode is still in flight (or whose extras are
        // incomplete) leaves that obligation unfulfilled, and Android kills the whole app
        // a few seconds later with ForegroundServiceDidNotStartInTimeException.
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

            startAdvertising(userUuid, companyUuid, userName);
        } else if (ACTION_STOP.equals(action)) {
            stopAdvertising();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

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

    // ── BLE advertising ─────────────────────────────────────────────────────

    private void startAdvertising(String userUuidStr, String companyUuidStr, String userName) {
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
            }

            @Override
            public void onStartFailure(int errorCode) {
                Log.e(TAG, "BLE advertising failed: " + describeError(errorCode));
            }
        };

        try {
            advertiser.startAdvertising(settings, advertiseData, scanResponse, advertiseCallback);
        } catch (SecurityException e) {
            Log.e(TAG, "BLUETOOTH_ADVERTISE permission not granted: " + e.getMessage());
        }
    }

    private void stopAdvertising() {
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
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
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

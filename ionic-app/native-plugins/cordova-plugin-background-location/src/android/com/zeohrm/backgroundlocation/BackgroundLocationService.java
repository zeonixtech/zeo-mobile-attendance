package com.zeohrm.backgroundlocation;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.location.LocationManagerCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class BackgroundLocationService extends Service {
    private static final String TAG = "BackgroundLocationSvc";
    private static final String CHANNEL_ID = "zeohrm_location_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final String MOCK_WARNING_CHANNEL_ID = "zeohrm_mock_warning_channel";
    private static final int MOCK_WARNING_NOTIFICATION_ID = 1002;
    private static final String LOCATION_WARNING_CHANNEL_ID = "zeohrm_location_warning_channel";
    private static final int LOCATION_WARNING_NOTIFICATION_ID = 1004;
    
    // Default 30 minutes
    private static final long DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
    
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private Handler handler;
    private Runnable locationRunnable;
    private long updateIntervalMs = DEFAULT_INTERVAL_MS;
    
    private String notificationTitle = "ZeoHRM Location Tracking";
    private String notificationText = "Tracking your location for attendance";
    private String notificationIcon = "ic_notification";

    private String userId = "";
    private String email = "";
    private String apiUrl = "";
    private String apiKey = "";
    private String mode = "";

    private boolean isRunning = false;
    private CancellationTokenSource cancellationTokenSource;
    // Tracks the previous ping's mock status so the warning notification only fires on the
    // not-mock -> mock transition, not on every single flagged ping (would spam every
    // 1-30 min depending on updateIntervalMs for as long as mock location stays on).
    private boolean wasMockLocation = false;
    private BroadcastReceiver locationModeReceiver;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "Service created");

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        handler = new Handler(Looper.getMainLooper());
        cancellationTokenSource = new CancellationTokenSource();

        createNotificationChannel();
        createLocationCallback();
        registerLocationModeReceiver();
    }

    /**
     * Toggling Location off doesn't stop this foreground service or its ongoing
     * notification — fusedLocationClient just quietly stops delivering results, with
     * no error surfaced anywhere. Without this, tracking silently goes dark with no
     * signal to the user, especially if the app itself isn't open to catch it via the
     * WebView-side poll. Mirrors BleAdvertiserService's bluetoothStateReceiver.
     */
    private void registerLocationModeReceiver() {
        locationModeReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!isRunning) return;

                LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                boolean enabled = lm != null && LocationManagerCompat.isLocationEnabled(lm);
                if (!enabled) {
                    Log.w(TAG, "Location services disabled while tracking was expected to be running");
                    notifyLocationDisabled();
                }
            }
        };
        ContextCompat.registerReceiver(
                this,
                locationModeReceiver,
                new IntentFilter(LocationManager.MODE_CHANGED_ACTION),
                ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "onStartCommand: " + (intent != null ? intent.getAction() : "null"));
        
        if (intent != null && "STOP_SERVICE".equals(intent.getAction())) {
            stopForegroundService();
            return START_NOT_STICKY;
        }
        
        if (intent != null && "START_ON_BOOT".equals(intent.getAction())) {
            Log.d(TAG, "Starting on boot");
        }
        
        // Get config from intent, falling back to the last-persisted config — used by
        // BootReceiver-triggered restarts AND by the OS redelivering onStartCommand
        // with a null intent after a START_STICKY restart (e.g. this process getting
        // killed for memory and later respawned with no caller around to supply fresh
        // extras). Previously this whole block was skipped when intent was null, so a
        // null-intent restart silently reset mode/apiUrl/etc. to empty defaults instead
        // of recovering them from SharedPreferences as intended — causing pings with a
        // NULL mode. Every field now falls back the same way regardless of intent.
        SharedPreferences persisted = getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE);
        notificationTitle = orDefault(intent != null ? intent.getStringExtra("notificationTitle") : null, persisted.getString(BootReceiver.KEY_NOTIFICATION_TITLE, "ZeoHRM Location Tracking"));
        notificationText = orDefault(intent != null ? intent.getStringExtra("notificationText") : null, persisted.getString(BootReceiver.KEY_NOTIFICATION_TEXT, "Tracking your location for attendance"));
        notificationIcon = orDefault(intent != null ? intent.getStringExtra("notificationIcon") : null, persisted.getString(BootReceiver.KEY_NOTIFICATION_ICON, "ic_notification"));
        updateIntervalMs = intent != null
                ? intent.getLongExtra("interval", persisted.getLong(BootReceiver.KEY_INTERVAL, DEFAULT_INTERVAL_MS))
                : persisted.getLong(BootReceiver.KEY_INTERVAL, DEFAULT_INTERVAL_MS);
        userId = orDefault(intent != null ? intent.getStringExtra("userId") : null, persisted.getString(BootReceiver.KEY_USER_ID, ""));
        email = orDefault(intent != null ? intent.getStringExtra("email") : null, persisted.getString(BootReceiver.KEY_EMAIL, ""));
        apiUrl = orDefault(intent != null ? intent.getStringExtra("apiUrl") : null, persisted.getString(BootReceiver.KEY_API_URL, ""));
        apiKey = orDefault(intent != null ? intent.getStringExtra("apiKey") : null, persisted.getString(BootReceiver.KEY_API_KEY, ""));
        mode = orDefault(intent != null ? intent.getStringExtra("mode") : null, persisted.getString(BootReceiver.KEY_MODE, ""));

        startForegroundService();
        
        return START_STICKY;
    }

    private void startForegroundService() {
        // Must call startForeground() on every entry reached via startForegroundService(),
        // even if already running — otherwise a fresh startForegroundService() call that
        // lands here while a stop from the previous mode is still in flight leaves this
        // call's obligation unfulfilled, and Android kills the whole app a few seconds
        // later with ForegroundServiceDidNotStartInTimeException.
        Notification notification = createNotification();
        startForeground(NOTIFICATION_ID, notification);

        if (isRunning) {
            Log.d(TAG, "Service already running — notification/config refreshed");
            return;
        }

        isRunning = true;
        startPeriodicLocationUpdates();

        Log.d(TAG, "Foreground service started");
    }

    private void stopForegroundService() {
        Log.d(TAG, "Stopping foreground service");
        
        stopLocationUpdates();
        
        stopForeground(true);
        stopSelf();

        isRunning = false;

        Log.d(TAG, "Foreground service stopped");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "ZeoHRM Location Tracking",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Background location tracking for attendance");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);

            // Separate, higher-importance channel for the mock-location warning — the
            // tracking channel above is deliberately silent/low-priority, but a fake-GPS
            // warning should actually surface to the user, not blend into the ongoing
            // "tracking active" notification.
            NotificationChannel mockWarningChannel = new NotificationChannel(
                MOCK_WARNING_CHANNEL_ID,
                "Fake Location Warnings",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            mockWarningChannel.setDescription("Alerts when mock/fake GPS location is detected");

            // Separate channel for the Location-services-disabled warning, distinct from
            // both the silent tracking channel and the mock-location warning channel.
            NotificationChannel locationWarningChannel = new NotificationChannel(
                LOCATION_WARNING_CHANNEL_ID,
                "Location Warnings",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            locationWarningChannel.setDescription("Alerts when Location/GPS is turned off during tracking");

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
                manager.createNotificationChannel(mockWarningChannel);
                manager.createNotificationChannel(locationWarningChannel);
            }
        }
    }

    private void notifyLocationDisabled() {
        Intent appIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, appIntent != null ? appIntent : new Intent(),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, LOCATION_WARNING_CHANNEL_ID)
            .setContentTitle("Location Disabled")
            .setContentText("Location/GPS was turned off — attendance tracking has stopped. Please re-enable it.")
            .setSmallIcon(getNotificationIconResId())
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setChannelId(LOCATION_WARNING_CHANNEL_ID);
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(LOCATION_WARNING_NOTIFICATION_ID, builder.build());
        }
    }

    private Notification createNotification() {
        Intent appIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, appIntent != null ? appIntent : new Intent(),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Intent stopIntent = new Intent(this, BackgroundLocationService.class);
        stopIntent.setAction("STOP_SERVICE");
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        int iconResId = getNotificationIconResId();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(notificationTitle)
            .setContentText(notificationText)
            .setSmallIcon(iconResId)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .addAction(android.R.drawable.ic_media_pause, "Pause", stopPendingIntent);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setChannelId(CHANNEL_ID);
        }

        return builder.build();
    }

    private int getNotificationIconResId() {
        try {
            return getResources().getIdentifier(notificationIcon, "drawable", getPackageName());
        } catch (Exception e) {
            return android.R.drawable.ic_dialog_map;
        }
    }

    private void createLocationCallback() {
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult locationResult) {
                super.onLocationResult(locationResult);
                Location location = locationResult.getLastLocation();
                if (location != null) {
                    handleLocationUpdate(location);
                }
            }
        };
    }

    private void startPeriodicLocationUpdates() {
        // Request immediate location
        requestSingleLocationUpdate();
        
        // Schedule periodic updates
        locationRunnable = new Runnable() {
            @Override
            public void run() {
                if (isRunning) {
                    requestSingleLocationUpdate();
                    handler.postDelayed(this, updateIntervalMs);
                }
            }
        };
        
        handler.postDelayed(locationRunnable, updateIntervalMs);
    }

    private void requestSingleLocationUpdate() {
        if (!hasLocationPermissions()) {
            Log.w(TAG, "Location permissions not granted");
            return;
        }

        try {
            LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, updateIntervalMs)
                .setWaitForAccurateLocation(true)
                .setMinUpdateIntervalMillis(updateIntervalMs)
                .setMaxUpdateDelayMillis(updateIntervalMs)
                .build();

            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            );
        } catch (SecurityException e) {
            Log.e(TAG, "Security exception requesting location: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Error requesting location: " + e.getMessage());
        }
    }

    private void stopLocationUpdates() {
        if (locationRunnable != null) {
            handler.removeCallbacks(locationRunnable);
            locationRunnable = null;
        }
        
        if (locationCallback != null) {
            try {
                fusedLocationClient.removeLocationUpdates(locationCallback);
            } catch (Exception e) {
                Log.e(TAG, "Error removing location updates: " + e.getMessage());
            }
        }
        
        if (cancellationTokenSource != null) {
            cancellationTokenSource.cancel();
            cancellationTokenSource = new CancellationTokenSource();
        }
    }

    private void handleLocationUpdate(Location location) {
        boolean isMock = location.isFromMockProvider();
        Log.d(TAG, "Location received: " + location.getLatitude() + ", " + location.getLongitude() +
              " accuracy: " + location.getAccuracy() + "m isMock: " + isMock);

        if (isMock && !wasMockLocation) {
            notifyMockLocationDetected();
        }
        wasMockLocation = isMock;

        postLocationToBackend(location, isMock);
    }

    private void notifyMockLocationDetected() {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MOCK_WARNING_CHANNEL_ID)
            .setContentTitle("Fake GPS location detected")
            .setContentText("Mock location was detected while tracking attendance. This has been flagged.")
            .setSmallIcon(getNotificationIconResId())
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setChannelId(MOCK_WARNING_CHANNEL_ID);
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(MOCK_WARNING_NOTIFICATION_ID, builder.build());
        }
    }

    /**
     * POSTs the location reading straight to crm-apis from native code, on a
     * background thread. Runs independently of the WebView/JS layer so delivery
     * keeps working while the phone is locked or the app is closed.
     */
    private void postLocationToBackend(final Location location, final boolean isMock) {
        final String url = apiUrl;
        final String key = apiKey;
        if (url == null || url.isEmpty() || key == null || key.isEmpty()) {
            Log.w(TAG, "No API URL/key configured; skipping backend POST");
            return;
        }

        final String uid = userId;
        final String uemail = email;
        final String umode = mode;

        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                try {
                    String androidId = android.provider.Settings.Secure.getString(
                        getContentResolver(), android.provider.Settings.Secure.ANDROID_ID);

                    JSONObject json = new JSONObject();
                    json.put("userId", uid);
                    json.put("email", uemail);
                    json.put("mode", umode);
                    json.put("deviceId", androidId);
                    json.put("deviceModel", Build.MODEL);
                    json.put("platform", "Android");
                    json.put("latitude", location.getLatitude());
                    json.put("longitude", location.getLongitude());
                    json.put("accuracy", location.getAccuracy());
                    json.put("timestamp", location.getTime());
                    json.put("isMock", isMock);

                    connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setRequestMethod("POST");
                    connection.setRequestProperty("Content-Type", "application/json");
                    connection.setRequestProperty("x-api-key", key);
                    connection.setDoOutput(true);
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(15000);

                    try (OutputStream os = connection.getOutputStream()) {
                        os.write(json.toString().getBytes("UTF-8"));
                    }

                    int responseCode = connection.getResponseCode();
                    Log.d(TAG, "Location POST response: " + responseCode);
                } catch (Exception e) {
                    Log.e(TAG, "Error posting location to backend: " + e.getMessage());
                } finally {
                    if (connection != null) {
                        connection.disconnect();
                    }
                }
            }
        }).start();
    }

    private static String orDefault(String value, String fallback) {
        return (value == null || value.isEmpty()) ? fallback : value;
    }

    private boolean hasLocationPermissions() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
            == PackageManager.PERMISSION_GRANTED &&
               ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) 
            == PackageManager.PERMISSION_GRANTED;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "Service destroyed");
        if (locationModeReceiver != null) {
            try {
                unregisterReceiver(locationModeReceiver);
            } catch (IllegalArgumentException e) {
                // already unregistered — harmless
            }
            locationModeReceiver = null;
        }
        stopLocationUpdates();
        isRunning = false;
    }
}
package com.zeohrm.backgroundlocation;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

/**
 * Receives BOOT_COMPLETED and restarts {@link BackgroundLocationService} if the
 * user had tracking enabled before the device was rebooted.
 *
 * The last-known tracking config (userId/email/apiUrl/apiKey/notification
 * strings/interval) is written to SharedPreferences by
 * {@link BackgroundLocationPlugin} every time tracking is started, since a
 * boot-triggered restart has no JS layer around to supply it fresh.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    public static final String PREFS_NAME = "zeohrm_tracking_prefs";
    public static final String KEY_TRACKING = "isTracking";
    public static final String KEY_USER_ID = "userId";
    public static final String KEY_EMAIL = "email";
    public static final String KEY_API_URL = "apiUrl";
    public static final String KEY_API_KEY = "apiKey";
    public static final String KEY_MODE = "mode";
    public static final String KEY_INTERVAL = "interval";
    public static final String KEY_NOTIFICATION_TITLE = "notificationTitle";
    public static final String KEY_NOTIFICATION_TEXT = "notificationText";
    public static final String KEY_NOTIFICATION_ICON = "notificationIcon";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean wasTracking = prefs.getBoolean(KEY_TRACKING, false);
        if (!wasTracking) {
            Log.d(TAG, "Boot received but tracking was not active — skipping restart");
            return;
        }

        if (!hasLocationPermissions(context)) {
            Log.d(TAG, "Location permissions not granted yet; skipping service start on boot");
            return;
        }

        Log.i(TAG, "Boot completed — restarting background location service");

        Intent serviceIntent = new Intent(context, BackgroundLocationService.class);
        serviceIntent.setAction("START_ON_BOOT");
        serviceIntent.putExtra("userId", prefs.getString(KEY_USER_ID, ""));
        serviceIntent.putExtra("email", prefs.getString(KEY_EMAIL, ""));
        serviceIntent.putExtra("apiUrl", prefs.getString(KEY_API_URL, ""));
        serviceIntent.putExtra("apiKey", prefs.getString(KEY_API_KEY, ""));
        serviceIntent.putExtra("mode", prefs.getString(KEY_MODE, ""));
        serviceIntent.putExtra("interval", prefs.getLong(KEY_INTERVAL, 30 * 60 * 1000));
        serviceIntent.putExtra("notificationTitle", prefs.getString(KEY_NOTIFICATION_TITLE, "ZeoHRM Location Tracking"));
        serviceIntent.putExtra("notificationText", prefs.getString(KEY_NOTIFICATION_TEXT, "Tracking your location for attendance"));
        serviceIntent.putExtra("notificationIcon", prefs.getString(KEY_NOTIFICATION_ICON, "ic_notification"));

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
    }

    private boolean hasLocationPermissions(Context context) {
        boolean fineOrCoarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean foregroundServiceLocation = android.os.Build.VERSION.SDK_INT < 34
            || ContextCompat.checkSelfPermission(context, Manifest.permission.FOREGROUND_SERVICE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        return fineOrCoarse && foregroundServiceLocation;
    }
}

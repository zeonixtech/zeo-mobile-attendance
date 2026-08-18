package com.zeohrm.backgroundlocation;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class BackgroundLocationPlugin extends CordovaPlugin {
    private static final String TAG = "BackgroundLocationPlugin";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int BACKGROUND_PERMISSION_REQUEST_CODE = 1002;
    
    private CallbackContext permissionCallbackContext;
    private CallbackContext startCallbackContext;
    private boolean isServiceRunning = false;

    @Override
    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        Log.d(TAG, "Plugin initialized");
        
        // Check if service is already running
        checkServiceStatus();
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        Log.d(TAG, "Executing action: " + action);
        
        switch (action) {
            case "startTracking":
                startTracking(args, callbackContext);
                return true;
            case "stopTracking":
                stopTracking(callbackContext);
                return true;
            case "getStatus":
                getStatus(callbackContext);
                return true;
            case "getCurrentLocation":
                getCurrentLocation(callbackContext);
                return true;
            case "requestPermissions":
                requestPermissions(callbackContext);
                return true;
            case "openAppSettings":
                openAppSettings(callbackContext);
                return true;
            default:
                callbackContext.error("Unknown action: " + action);
                return false;
        }
    }

    /** Deep-links into this app's system Settings page, for when Android has
     *  permanently stopped showing its own permission dialog after repeated denials. */
    private void openAppSettings(CallbackContext callbackContext) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", cordova.getActivity().getPackageName(), null);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            cordova.getActivity().startActivity(intent);
            callbackContext.success();
        } catch (Exception e) {
            Log.e(TAG, "Error opening app settings", e);
            callbackContext.error("Failed to open settings: " + e.getMessage());
        }
    }

    private SharedPreferences prefs() {
        return cordova.getActivity().getApplicationContext()
                .getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE);
    }

    private void startTracking(JSONArray args, CallbackContext callbackContext) {
        this.startCallbackContext = callbackContext;
        
        // Check permissions first
        if (!hasLocationPermissions()) {
            requestPermissions(new CallbackContext("permissions", webView) {
                @Override
                public void success(JSONObject result) {
                    doStartTracking(args);
                }
                
                @Override
                public void error(JSONObject result) {
                    callbackContext.error("Location permissions required");
                }
            });
            return;
        }
        
        doStartTracking(args);
    }

    private void doStartTracking(JSONArray args) {
        try {
            JSONObject config = args.length() > 0 ? args.getJSONObject(0) : new JSONObject();

            String notificationTitle = config.optString("notificationTitle", "ZeoHRM Location Tracking");
            String notificationText = config.optString("notificationText", "Tracking your location for attendance");
            String notificationIcon = config.optString("notificationIcon", "ic_notification");
            long interval = config.optLong("interval", 30 * 60 * 1000);
            String userId = config.optString("userId", "");
            String email = config.optString("email", "");
            String apiUrl = config.optString("apiUrl", "");
            String apiKey = config.optString("apiKey", "");
            String mode = config.optString("mode", "");

            // Persist so BootReceiver can restart tracking with the same identity/config
            // after a device reboot, when there's no JS layer around to supply it fresh.
            prefs().edit()
                    .putBoolean(BootReceiver.KEY_TRACKING, true)
                    .putString(BootReceiver.KEY_USER_ID, userId)
                    .putString(BootReceiver.KEY_EMAIL, email)
                    .putString(BootReceiver.KEY_API_URL, apiUrl)
                    .putString(BootReceiver.KEY_API_KEY, apiKey)
                    .putString(BootReceiver.KEY_MODE, mode)
                    .putLong(BootReceiver.KEY_INTERVAL, interval)
                    .putString(BootReceiver.KEY_NOTIFICATION_TITLE, notificationTitle)
                    .putString(BootReceiver.KEY_NOTIFICATION_TEXT, notificationText)
                    .putString(BootReceiver.KEY_NOTIFICATION_ICON, notificationIcon)
                    .apply();

            Intent serviceIntent = new Intent(cordova.getActivity(), BackgroundLocationService.class);
            serviceIntent.putExtra("notificationTitle", notificationTitle);
            serviceIntent.putExtra("notificationText", notificationText);
            serviceIntent.putExtra("notificationIcon", notificationIcon);
            serviceIntent.putExtra("interval", interval);
            serviceIntent.putExtra("userId", userId);
            serviceIntent.putExtra("email", email);
            serviceIntent.putExtra("apiUrl", apiUrl);
            serviceIntent.putExtra("apiKey", apiKey);
            serviceIntent.putExtra("mode", mode);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                cordova.getActivity().startForegroundService(serviceIntent);
            } else {
                cordova.getActivity().startService(serviceIntent);
            }

            isServiceRunning = true;
            startCallbackContext.success("Background location service started");

        } catch (Exception e) {
            Log.e(TAG, "Error starting tracking", e);
            startCallbackContext.error("Failed to start tracking: " + e.getMessage());
        }
    }

    private void stopTracking(CallbackContext callbackContext) {
        prefs().edit().putBoolean(BootReceiver.KEY_TRACKING, false).apply();

        Intent serviceIntent = new Intent(cordova.getActivity(), BackgroundLocationService.class);
        serviceIntent.setAction("STOP_SERVICE");
        cordova.getActivity().startService(serviceIntent);

        isServiceRunning = false;
        callbackContext.success("Background location service stopped");
    }

    private void getStatus(CallbackContext callbackContext) {
        try {
            JSONObject result = new JSONObject();
            result.put("isRunning", isServiceRunning);
            callbackContext.success(result);
        } catch (JSONException e) {
            callbackContext.error("Error getting status: " + e.getMessage());
        }
    }

    private void getCurrentLocation(CallbackContext callbackContext) {
        // For immediate location, we could use FusedLocationProviderClient
        // For now, return a message indicating the service handles periodic updates
        try {
            JSONObject result = new JSONObject();
            result.put("message", "Location updates are sent periodically by the background service");
            result.put("isRunning", isServiceRunning);
            callbackContext.success(result);
        } catch (JSONException e) {
            callbackContext.error("Error getting location: " + e.getMessage());
        }
    }

    private void requestPermissions(CallbackContext callbackContext) {
        this.permissionCallbackContext = callbackContext;

        // Android 11+ (API 30+) rejects requesting ACCESS_BACKGROUND_LOCATION together with
        // foreground location permissions in the same call. Foreground permissions must be
        // granted first, then background location requested separately.
        String[] foregroundPermissions = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.FOREGROUND_SERVICE,
            Manifest.permission.FOREGROUND_SERVICE_LOCATION
        };

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            cordova.requestPermissions(this, PERMISSION_REQUEST_CODE, foregroundPermissions);
        } else {
            callbackContext.success("Permissions granted (pre-Marshmallow)");
        }
    }

    private void requestBackgroundLocationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            cordova.requestPermissions(this, BACKGROUND_PERMISSION_REQUEST_CODE,
                new String[]{ Manifest.permission.ACCESS_BACKGROUND_LOCATION });
        } else {
            finishPermissionRequest(true);
        }
    }

    private void finishPermissionRequest(boolean granted) {
        if (permissionCallbackContext != null) {
            if (granted) {
                permissionCallbackContext.success("All permissions granted");
            } else {
                permissionCallbackContext.error("Some permissions denied");
            }
            permissionCallbackContext = null;
        }
    }

    private boolean hasLocationPermissions() {
        Context context = cordova.getActivity().getApplicationContext();
        
        boolean fineLocation = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) 
            == PackageManager.PERMISSION_GRANTED;
        boolean coarseLocation = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) 
            == PackageManager.PERMISSION_GRANTED;
        boolean backgroundLocation = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || 
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) 
            == PackageManager.PERMISSION_GRANTED;
        boolean foregroundService = ContextCompat.checkSelfPermission(context, Manifest.permission.FOREGROUND_SERVICE) 
            == PackageManager.PERMISSION_GRANTED;
        
        return fineLocation && coarseLocation && backgroundLocation && foregroundService;
    }

    private void checkServiceStatus() {
        // Could check if service is running via ActivityManager
        isServiceRunning = false; // Default to false
    }

    @Override
    public void onRequestPermissionResult(int requestCode, String[] permissions, int[] grantResults) throws JSONException {
        boolean allGranted = true;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                allGranted = false;
                break;
            }
        }

        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (!allGranted) {
                finishPermissionRequest(false);
                return;
            }
            // Foreground permissions granted; request background location separately.
            requestBackgroundLocationPermission();
        } else if (requestCode == BACKGROUND_PERMISSION_REQUEST_CODE) {
            finishPermissionRequest(allGranted);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "Plugin destroyed");
    }
}
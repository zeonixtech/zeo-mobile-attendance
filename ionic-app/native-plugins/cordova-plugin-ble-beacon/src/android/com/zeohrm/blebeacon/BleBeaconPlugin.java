package com.zeohrm.blebeacon;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class BleBeaconPlugin extends CordovaPlugin {
    private static final String TAG = "BleBeaconPlugin";
    private static final int PERMISSION_REQUEST_CODE = 2001;

    private CallbackContext startCallbackContext;
    private String pendingUserUuid;
    private String pendingCompanyUuid;
    private String pendingUserName;

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        switch (action) {
            case "startAdvertising":
                startAdvertising(args, callbackContext);
                return true;
            case "stopAdvertising":
                stopAdvertising(callbackContext);
                return true;
            case "getStatus":
                getStatus(callbackContext);
                return true;
            case "isBluetoothEnabled":
                isBluetoothEnabled(callbackContext);
                return true;
            default:
                callbackContext.error("Unknown action: " + action);
                return false;
        }
    }

    private void startAdvertising(JSONArray args, CallbackContext callbackContext) throws JSONException {
        JSONObject options = args.length() > 0 ? args.getJSONObject(0) : new JSONObject();
        String userUuid = options.optString("userUuid", null);
        String companyUuid = options.optString("companyServiceUuid", null);
        String userName = options.optString("userName", "UNKNOWN");

        if (userUuid == null || companyUuid == null || userUuid.isEmpty() || companyUuid.isEmpty()) {
            callbackContext.error("userUuid and companyServiceUuid are required");
            return;
        }

        this.startCallbackContext = callbackContext;
        this.pendingUserUuid = userUuid;
        this.pendingCompanyUuid = companyUuid;
        this.pendingUserName = userName;

        if (!hasBluetoothPermissions()) {
            requestBluetoothPermissions();
            return;
        }

        launchService(userUuid, companyUuid, userName, callbackContext);
    }

    private void launchService(String userUuid, String companyUuid, String userName, CallbackContext callbackContext) {
        prefs().edit()
                .putString(BootReceiver.KEY_USER_UUID, userUuid)
                .putString(BootReceiver.KEY_COMPANY_UUID, companyUuid)
                .putString(BootReceiver.KEY_USER_NAME, userName)
                .putBoolean(BootReceiver.KEY_ADVERTISING, true)
                .apply();

        Intent intent = new Intent(cordova.getActivity(), BleAdvertiserService.class);
        intent.setAction(BleAdvertiserService.ACTION_START);
        intent.putExtra(BleAdvertiserService.EXTRA_USER_UUID, userUuid);
        intent.putExtra(BleAdvertiserService.EXTRA_COMPANY_UUID, companyUuid);
        intent.putExtra(BleAdvertiserService.EXTRA_USER_NAME, userName);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            cordova.getActivity().startForegroundService(intent);
        } else {
            cordova.getActivity().startService(intent);
        }

        callbackContext.success();
    }

    private void stopAdvertising(CallbackContext callbackContext) {
        prefs().edit().putBoolean(BootReceiver.KEY_ADVERTISING, false).apply();

        Intent intent = new Intent(cordova.getActivity(), BleAdvertiserService.class);
        intent.setAction(BleAdvertiserService.ACTION_STOP);
        cordova.getActivity().startService(intent);

        callbackContext.success();
    }

    private void getStatus(CallbackContext callbackContext) {
        try {
            boolean running = prefs().getBoolean(BootReceiver.KEY_ADVERTISING, false);
            JSONObject result = new JSONObject();
            result.put("isRunning", running);
            callbackContext.success(result);
        } catch (JSONException e) {
            callbackContext.error("Error getting status: " + e.getMessage());
        }
    }

    private void isBluetoothEnabled(CallbackContext callbackContext) {
        try {
            android.bluetooth.BluetoothManager btManager =
                (android.bluetooth.BluetoothManager) cordova.getActivity().getSystemService(Context.BLUETOOTH_SERVICE);
            android.bluetooth.BluetoothAdapter btAdapter = btManager != null ? btManager.getAdapter() : null;
            boolean enabled = btAdapter != null && btAdapter.isEnabled();
            JSONObject result = new JSONObject();
            result.put("enabled", enabled);
            callbackContext.success(result);
        } catch (JSONException e) {
            callbackContext.error("Error checking Bluetooth state: " + e.getMessage());
        }
    }

    private SharedPreferences prefs() {
        return cordova.getActivity().getApplicationContext()
                .getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE);
    }

    private boolean hasBluetoothPermissions() {
        Context context = cordova.getActivity().getApplicationContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE)
                        == PackageManager.PERMISSION_GRANTED
                    && ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT)
                        == PackageManager.PERMISSION_GRANTED;
        }
        // Pre-Android 12: BLUETOOTH / BLUETOOTH_ADMIN are normal permissions, granted at install time.
        return true;
    }

    private void requestBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            cordova.requestPermissions(this, PERMISSION_REQUEST_CODE, new String[]{
                    Manifest.permission.BLUETOOTH_ADVERTISE,
                    Manifest.permission.BLUETOOTH_CONNECT,
                    Manifest.permission.BLUETOOTH_SCAN
            });
        } else {
            launchService(pendingUserUuid, pendingCompanyUuid, pendingUserName, startCallbackContext);
        }
    }

    @Override
    public void onRequestPermissionResult(int requestCode, String[] permissions, int[] grantResults) throws JSONException {
        if (requestCode != PERMISSION_REQUEST_CODE) return;

        boolean allGranted = true;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                allGranted = false;
                break;
            }
        }

        if (startCallbackContext == null) return;

        if (allGranted) {
            launchService(pendingUserUuid, pendingCompanyUuid, pendingUserName, startCallbackContext);
        } else {
            startCallbackContext.error("Bluetooth permission denied — grant it in Settings > Apps > Permissions");
        }
    }
}

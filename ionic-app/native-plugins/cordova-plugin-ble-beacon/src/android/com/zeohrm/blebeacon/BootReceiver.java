package com.zeohrm.blebeacon;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * Receives BOOT_COMPLETED and restarts {@link BleAdvertiserService} if the user
 * had advertising enabled before the device was rebooted.
 *
 * The last-known UUIDs are written to SharedPreferences by {@link BleBeaconPlugin}
 * every time advertising is started.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BleBootReceiver";

    public static final String PREFS_NAME = "ble_beacon_prefs";
    public static final String KEY_USER_UUID = "userUuid";
    public static final String KEY_COMPANY_UUID = "companyServiceUuid";
    public static final String KEY_USER_NAME = "userName";
    public static final String KEY_ADVERTISING = "isAdvertising";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean wasAdvertising = prefs.getBoolean(KEY_ADVERTISING, false);
        if (!wasAdvertising) {
            Log.d(TAG, "Boot received but advertising was not active — skipping restart");
            return;
        }

        String userUuid = prefs.getString(KEY_USER_UUID, null);
        String companyUuid = prefs.getString(KEY_COMPANY_UUID, null);
        String userName = prefs.getString(KEY_USER_NAME, "UNKNOWN");

        if (userUuid == null || companyUuid == null) {
            Log.w(TAG, "Boot received but UUIDs not found in prefs — cannot restart");
            return;
        }

        Log.i(TAG, "Boot completed — restarting BLE advertiser service");

        Intent serviceIntent = new Intent(context, BleAdvertiserService.class);
        serviceIntent.setAction(BleAdvertiserService.ACTION_START);
        serviceIntent.putExtra(BleAdvertiserService.EXTRA_USER_UUID, userUuid);
        serviceIntent.putExtra(BleAdvertiserService.EXTRA_COMPANY_UUID, companyUuid);
        serviceIntent.putExtra(BleAdvertiserService.EXTRA_USER_NAME, userName);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
    }
}

var exec = require('cordova/exec');

var BleBeacon = {
    /**
     * Start background BLE peripheral advertising.
     * @param {Object} options
     * @param {string} options.userUuid - 128-bit user UUID (dashes included)
     * @param {string} options.companyServiceUuid - 128-bit company service UUID the scanner filters on
     * @param {string} [options.userName] - Short name/ID broadcast as manufacturer data
     * @returns {Promise} Resolves when advertising starts
     */
    startAdvertising: function (options) {
        options = options || {};
        return new Promise(function (resolve, reject) {
            exec(resolve, reject, 'BleBeacon', 'startAdvertising', [options]);
        });
    },

    /**
     * Stop background BLE peripheral advertising.
     * @returns {Promise} Resolves when advertising stops
     */
    stopAdvertising: function () {
        return new Promise(function (resolve, reject) {
            exec(resolve, reject, 'BleBeacon', 'stopAdvertising', []);
        });
    },

    /**
     * Get current advertising status.
     * @returns {Promise<{isRunning: boolean}>}
     */
    getStatus: function () {
        return new Promise(function (resolve, reject) {
            exec(resolve, reject, 'BleBeacon', 'getStatus', []);
        });
    }
};

module.exports = BleBeacon;

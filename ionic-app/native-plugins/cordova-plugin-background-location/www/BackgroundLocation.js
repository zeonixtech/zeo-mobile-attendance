var exec = require('cordova/exec');

var BackgroundLocation = {
    /**
     * Start background location tracking
     * @param {Object} options - Configuration options
     * @param {string} [options.notificationTitle='ZeoHRM Location Tracking'] - Notification title
     * @param {string} [options.notificationText='Tracking your location for attendance'] - Notification text
     * @param {string} [options.notificationIcon='ic_notification'] - Notification icon (drawable name)
     * @param {number} [options.interval=1800000] - Update interval in milliseconds (default: 30 minutes)
     * @returns {Promise} Resolves when service starts
     */
    startTracking: function(options) {
        options = options || {};
        var defaults = {
            notificationTitle: 'ZeoHRM Location Tracking',
            notificationText: 'Tracking your location for attendance',
            notificationIcon: 'ic_notification',
            interval: 30 * 60 * 1000 // 30 minutes
        };
        
        // Merge options with defaults
        for (var key in defaults) {
            if (!(key in options)) {
                options[key] = defaults[key];
            }
        }
        
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'BackgroundLocation', 'startTracking', [options]);
        });
    },

    /**
     * Stop background location tracking
     * @returns {Promise} Resolves when service stops
     */
    stopTracking: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'BackgroundLocation', 'stopTracking', []);
        });
    },

    /**
     * Get current tracking status
     * @returns {Promise<{isRunning: boolean}>} Current status
     */
    getStatus: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'BackgroundLocation', 'getStatus', []);
        });
    },

    /**
     * Get current location (one-time request)
     * @returns {Promise<LocationData>} Current location
     */
    getCurrentLocation: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'BackgroundLocation', 'getCurrentLocation', []);
        });
    },

    /**
     * Fresh one-shot location fix with mock-provider detection — used to gate
     * Check In/Check Out at the moment of confirming.
     * @returns {Promise<{latitude: number, longitude: number, accuracy: number, isMock: boolean}>}
     */
    checkMockLocation: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'BackgroundLocation', 'checkMockLocation', []);
        });
    },

    /**
     * Check whether the device's Location service (GPS/network provider) is currently enabled.
     * @returns {Promise<{enabled: boolean}>}
     */
    isLocationServiceEnabled: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'BackgroundLocation', 'isLocationServiceEnabled', []);
        });
    },

    /**
     * Listen for location updates
     * @param {Function} callback - Called with location data
     * @returns {Function} Unsubscribe function
     */
    onLocationUpdate: function(callback) {
        var listener = function(event) {
            callback(event.detail);
        };

        document.addEventListener('backgroundlocation.locationupdate', listener);

        return function() {
            document.removeEventListener('backgroundlocation.locationupdate', listener);
        };
    },

    /**
     * Listen for status changes
     * @param {Function} callback - Called with status
     * @returns {Function} Unsubscribe function
     */
    onStatusChange: function(callback) {
        var listener = function(event) {
            callback(event.detail);
        };

        document.addEventListener('backgroundlocation.statuschange', listener);

        return function() {
            document.removeEventListener('backgroundlocation.statuschange', listener);
        };
    }
};

// Auto-register broadcast receivers for JS communication
document.addEventListener('deviceready', function() {
    // Listen for location updates from native service
    var originalExec = exec;
    exec = function(success, error, service, action, args) {
        return originalExec(success, error, service, action, args);
    };
    
    // Register for native broadcasts
    if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.BackgroundLocation) {
        // The native plugin will broadcast events we can listen to
    }
}, false);

module.exports = BackgroundLocation;
/*
 * View model for OctoPrint-NetworkManager
 *
 * Author: Pim Rutgers
 * License: AGPLv3
 *
 * Lots of credit to Gina Häußge <osd@foosel.net> for OctoPrint-Netconnectd implementation. 
 * Many ideas and code orignates from that plugin.
 *
 */
$(function() {
    function NetworkmanagerViewModel(parameters) {
        var self = this;

        self.loginState = parameters[0];
        self.settingsViewModel = parameters[1];

        self.pollingEnabled = false;
        self.pollingTimeoutId = undefined;

        self.connectionsId = undefined;
        self.connectId = undefined;

        self.statusCurrentWifi = ko.observable();
        self.enableSignalSorting = ko.observable(false);


        self.status = {
            connection: {
                wifi: ko.observable(),
                ethernet: ko.observable()
            },
            wifi: {
                ssid: ko.observable(),
                signal: ko.observable(),
                security: ko.observable()
            }
        };

        self.editorWifi = undefined;
        self.editorWifiSsid = ko.observable();
        self.editorWifiPassphrase1 = ko.observable();
        self.editorWifiPassphrase2 = ko.observable();
        self.editorWifiPassphraseMismatch = ko.computed(function() {
            return self.editorWifiPassphrase1() !== self.editorWifiPassphrase2();
        });

        self.working = ko.observable(false);
        self.error = ko.observable(false);

        self.ethernetConnectionText = ko.computed(function() {
            if(self.status.connection.ethernet()){
                return "Connected";
            }
            return "Disconnected";
        });

        // initialize list helper
        self.listHelper = new ItemListHelper(
            "wifis",
            {
                "ssid": function (a, b) {
                    // sorts ascending
                    if (a["ssid"].toLocaleLowerCase() < b["ssid"].toLocaleLowerCase()) return -1;
                    if (a["ssid"].toLocaleLowerCase() > b["ssid"].toLocaleLowerCase()) return 1;
                    return 0;
                },
                "quality": function (a, b) {
                    // sorts descending
                    if (a["signal"] > b["signal"]) return -1;
                    if (a["signal"] < b["signal"]) return 1;
                    return 0;
                }
            },
            {
            },
            "signal",
            [],
            [],
            10
        );

        self.refresh = function() {
            self.requestData();
        };

        self.toggleConnectEditor = function() {
            self.connectionsId.toggleClass('active');
            self.connectId.toggleClass('active');

        };

        self.configureWifi = function(data) {
            if (!self.loginState.isAdmin()) return; // Maybe do something with this return 

            self.editorWifi = data;
            self.editorWifiSsid(data.ssid);
            self.editorWifiPassphrase1(undefined);
            self.editorWifiPassphrase2(undefined);
            if (data.security) {
                self.toggleConnectEditor();
            } else {
                self.confirmWifiConfiguration();
            }
        };

        self.confirmWifiConfiguration = function() {
            self.sendWifiConfig(self.editorWifiSsid(), self.editorWifiPassphrase1(), function() {
                self.cancelWifiConfiguration();
            });
        };

        self.cancelWifiConfiguration = function() {
            self.editorWifi = undefined;
            self.editorWifiSsid(undefined);
            self.editorWifiPassphrase1(undefined);
            self.editorWifiPassphrase2(undefined);
            self.toggleConnectEditor();   
        };

        self.sendWifiConfig = function(ssid, psk, successCallback, failureCallback) {
            if (!self.loginState.isAdmin()) return; // Do something with error again?

            self.working(true);
            self._postCommand("configure_wifi", {ssid: ssid, psk: psk}, successCallback, failureCallback, function() {
                self.working(false);
                self.toggleConnectEditor();   
            }, 5000); // LEFT HERE: FIX IF NEEDED


        };

        self.sendWifiDisconnect = function (successCallback, failureCallback) {
            if (!self.loginState.isAdmin()) return;
            successCallback == successCallback || function() {
                $.notify({
                    title: "Disconnected succes",
                    text: "You have successfully disconnected the wifi connection",
                    "success"
                });
            };

            self._postCommand("disconnect_wifi", {}, successCallback, failureCallback, function() {
                self.requestData();   
            });
        }

        self.sendReset = function() {
            if (!self.loginState.isAdmin()) return;

            self._postCommand("reset", {});
        };

        self.requestData = function () {
            if (self.pollingTimeoutId !== undefined) {
                clearTimeout(self.pollingTimeoutId);
                self.pollingTimeoutId = undefined;
            }

            $.ajax({
                url: API_BASEURL + "plugin/networkmanager",
                type: "GET",
                dataType: "json",
                success: self.fromResponse
            });
        };

        self.sendWifiRefresh = function(force) {
            if (force === undefined) force = false;
            self.working = true;
            self._postCommand("scan_wifi", {force: force}, function(response) {
                self.fromResponse({"wifis": response});
                self.working = false;
            });
        };


        // self.onStartUp = function(){
        // };

        self.onBeforeBinding = function() {
            self.connectionsId = $('#networkmanager_connections');
            self.connectId = $('#networkmanager_connect');
            self.settings = self.settingsViewModel.settings;
        };

        self.onSettingsShown = function() {
            self.pollingEnabled = true;
            self.requestData();
        };

        self.onSettingsHidden = function() {
            if (self.pollingTimeoutId !== undefined) {
                self.pollingTimeoutId = undefined;
            }
            self.pollingEnabled = false;
        };

        self.getEntryId = function(data) {
            return "settings_plugin_networkmanager_wifi_" + md5(data.ssid);
        };

        self.isActive = function(data) {
            if (self.getEntryId(data) === self.statusCurrentWifi()) {
                return "fa-check";
            }
        };

        self.isEncrypted = function(data) {
            if (data.security){
                return "fa-lock";
            }
        };

        self._postCommand = function (command, data, successCallback, failureCallback, alwaysCallback, timeout) {
            var payload = _.extend(data, {command: command});

            var params = {
                url: API_BASEURL + "plugin/networkmanager",
                type: "POST",
                dataType: "json",
                data: JSON.stringify(payload),
                contentType: "application/json; charset=UTF-8",
                success: function(response) {
                    if (successCallback) successCallback(response);
                },
                error: function() {
                    if (failureCallback) failureCallback();
                },
                complete: function() {
                    if (alwaysCallback) alwaysCallback();
                }
            };

            if (timeout !== undefined) {
                params.timeout = timeout;
            }

            $.ajax(params);
        };

        self.fromResponse = function (response) {
            if (response.error !== undefined) {
                self.error(true);
                return;
            } else {
                self.error(false);
            }

            self.status.connection.wifi(response.status.connection.wifi);
            self.status.connection.ethernet(response.status.connection.ethernet);
            self.status.wifi.ssid(response.status.wifi.ssid);
            self.status.wifi.signal(response.status.wifi.signal);
            self.status.wifi.security(response.status.wifi.security);

            self.statusCurrentWifi(undefined);
            if (response.status.wifi.ssid) {
                _.each(response.wifis, function(wifi) {
                    if (wifi.ssid === response.status.wifi.ssid) {
                        self.statusCurrentWifi(self.getEntryId(wifi));
                    }
                });
            }

            var enableSignalSorting = false;
            _.each(response.wifis, function(wifi) {
                if (wifi.signal !== undefined) {
                    enableSignalSorting = true;
                }
            });
            self.enableSignalSorting(enableSignalSorting);

            var wifis = [];
            _.each(response.wifis, function(wifi) {
                wifis.push({
                    ssid: wifi.ssid,
                    signal: wifi.signal,
                    security: wifi.security,
                });
            });

            self.listHelper.updateItems(wifis);
            if (!enableSignalSorting) {
                self.listHelper.changeSorting("ssid");
            }

            if (self.pollingEnabled) {
                self.pollingTimeoutId = setTimeout(function() {
                    self.requestData();
                }, 30000);
            }
        };

    }

    // view model class, parameters for constructor, container to bind to
    OCTOPRINT_VIEWMODELS.push([
        NetworkmanagerViewModel,

        [ "loginStateViewModel", "settingsViewModel"],

        // e.g. #settings_plugin_networkmanager, #tab_plugin_networkmanager, ...
        [ "#settings_plugin_networkmanager"]
    ]);
});



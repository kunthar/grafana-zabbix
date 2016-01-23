define([
  'angular',
  'lodash',
  './utils'
],
function (angular, _, utils) {
  'use strict';

  var module = angular.module('grafana.services');

  module.factory('QueryBuilder', function() {

    function QueryBuilder(zabbixCacheInstance) {
      var self = this;

      this.cache = zabbixCacheInstance;

      /**
       * Build query - convert target filters to array of Zabbix items
       */
      this.build = function (groupFilter, hostFilter, appFilter, itemFilter) {

        // Find items by item names and perform queries
        var groups = [];
        var hosts = [];
        var apps = [];
        var items = [];

        if (utils.isRegex(hostFilter)) {

          // Filter groups
          if (utils.isRegex(groupFilter)) {
            var groupPattern = utils.buildRegex(groupFilter);
            groups = _.filter(this.cache.getGroups(), function (groupObj) {
              return groupPattern.test(groupObj.name);
            });
          } else {
            var findedGroup = _.find(this.cache.getGroups(), {'name': groupFilter});
            if (findedGroup) {
              groups.push(findedGroup);
            } else {
              groups = undefined;
            }
          }
          if (groups) {
            var groupids = _.map(groups, 'groupid');
            hosts = _.filter(this.cache.getHosts(), function (hostObj) {
              return _.intersection(groupids, hostObj.groups).length;
            });
          } else {
            // No groups finded
            return [];
          }

          // Filter hosts
          var hostPattern = utils.buildRegex(hostFilter);
          hosts = _.filter(hosts, function (hostObj) {
            return hostPattern.test(hostObj.name);
          });
        } else {
          var findedHost = _.find(this.cache.getHosts(), {'name': hostFilter});
          if (findedHost) {
            hosts.push(findedHost);
          } else {
            // No hosts finded
            return [];
          }
        }

        // Find items belongs to selected hosts
        items = _.filter(this.cache.getItems(), function (itemObj) {
          return _.contains(_.map(hosts, 'hostid'), itemObj.hostid);
        });

        if (utils.isRegex(itemFilter)) {

          // Filter applications
          if (utils.isRegex(appFilter)) {
            var appPattern = utils.buildRegex(appFilter);
            apps = _.filter(this.cache.getApplications(), function (appObj) {
              return appPattern.test(appObj.name);
            });
          }
          // Don't use application filter if it empty
          else if (appFilter === "") {
            apps = undefined;
          }
          else {
            var findedApp = _.find(this.cache.getApplications(), {'name': appFilter});
            if (findedApp) {
              apps.push(findedApp);
            } else {
              // No applications finded
              return [];
            }
          }

          // Find items belongs to selected applications
          if (apps) {
            var appids = _.flatten(_.map(apps, 'applicationids'));
            items = _.filter(items, function (itemObj) {
              return _.intersection(appids, itemObj.applications).length;
            });
          }

          if (items) {
            var itemPattern = utils.buildRegex(itemFilter);
            items = _.filter(items, function (itemObj) {
              return itemPattern.test(itemObj.name);
            });
          } else {
            // No items finded
            return [];
          }
        } else {
          items = _.filter(items, {'name': hostFilter});
          if (!items.length) {
            // No items finded
            return [];
          }
        }

        // Set host as host name for each item
        items = _.each(items, function (itemObj) {
          itemObj.host = _.find(hosts, {'hostid': itemObj.hostid}).name;
        });

        return items;
      };

      /**
       * Convert Zabbix API history.get response to Grafana format
       *
       * @return {Array}            Array of timeseries in Grafana format
       *                            {
       *                               target: "Metric name",
       *                               datapoints: [[<value>, <unixtime>], ...]
       *                            }
       */
      this.convertHistory = function(history, addHostName, convertPointCallback) {
        /**
         * Response should be in the format:
         * data: [
         *          {
         *             target: "Metric name",
         *             datapoints: [[<value>, <unixtime>], ...]
         *          }, ...
         *       ]
         */

        // Group history by itemid
        var grouped_history = _.groupBy(history, 'itemid');

        return _.map(grouped_history, function(hist, itemid) {
          var item = self.cache.getItem(itemid);
          var alias = item.name;
          if (addHostName) {
            var host = self.cache.getHost(item.hostid);
            alias = host.name + ": " + alias;
          }
          return {
            target: alias,
            datapoints: _.map(hist, convertPointCallback)
          };
        });
      };

      this.handleHistory = function(history, addHostName) {
        return this.convertHistory(history, addHostName, convertHistoryPoint);
      };

      this.handleTrends = function(history, addHostName, valueType) {
        var convertPointCallback = _.partial(convertTrendPoint, valueType);
        return this.convertHistory(history, addHostName, convertPointCallback);
      };

      function convertHistoryPoint(point) {
        // Value must be a number for properly work
        return [
          Number(point.value),
          point.clock * 1000
        ];
      }

      function convertTrendPoint(valueType, point) {
        var value;
        switch (valueType) {
          case "min":
            value = point.value_min;
            break;
          case "max":
            value = point.value_max;
            break;
          case "avg":
            value = point.value_avg;
            break;
          default:
            value = point.value_avg;
        }

        return [
          Number(value),
          point.clock * 1000
        ];
      }
    }

    return QueryBuilder;
  });

});
'use strict';

let Service;
let Characteristic;
let communicationError;

class HomeAssistantSensor {
  constructor(log, data, client, service, characteristic, transformData, characteristic2, transformData2) {
    // device info
    this.data = data;
    this.entity_id = data.entity_id;
    this.uuid_base = data.entity_id;
    if (data.attributes && data.attributes.friendly_name) {
      this.name = data.attributes.friendly_name;
    } else {
      this.name = data.entity_id.split('.').pop().replace(/_/g, ' ');
    }
    if (data.attributes && data.attributes.homebridge_mfg) {
      this.mfg = String(data.attributes.homebridge_mfg);
    } else {
      this.mfg = 'Home Assistant';
    }
    if (data.attributes && data.attributes.homebridge_model) {
      this.model = String(data.attributes.homebridge_model);
    } else {
      this.model = 'Sensor';
    }
    if (data.attributes && data.attributes.homebridge_serial) {
      this.serial = String(data.attributes.homebridge_serial);
    } else {
      this.serial = data.entity_id;
    }
    this.entity_type = data.entity_id.split('.')[0];
    this.service = service;
    this.characteristic = characteristic;
    if (transformData) {
      this.transformData = transformData;
    }
    if (characteristic2) {
      this.characteristic2 = characteristic2;
    }        
    if (transformData2) {
      this.transformData2 = transformData2;
    }    
    this.client = client;
    this.log = log;
    this.batterySource = data.attributes.homebridge_battery_source;
    this.chargingSource = data.attributes.homebridge_charging_source;
  }

  transformData(data) {
    return parseFloat(data.state);
  }
  
    transformData2(data) {
    return parseFloat(data.state);
  }

  
  onEvent(oldState, newState) {
    if (this.service === Service.CarbonDioxideSensor) {
      const transformed = this.transformData(newState);
      this.sensorService.getCharacteristic(this.characteristic)
        .setValue(transformed, null, 'internal');

      const abnormal = Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL;
      const normal = Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL;
      const detected = (transformed > 1000 ? abnormal : normal);
      this.sensorService.getCharacteristic(Characteristic.CarbonDioxideDetected)
        .setValue(detected, null, 'internal');
    } else {
      this.sensorService.getCharacteristic(this.characteristic)
        .setValue(this.transformData(newState), null, 'internal');
      if (this.characteristic2) {
      this.sensorService.getCharacteristic(this.characteristic2)
        .setValue(this.transformData2(newState), null, 'internal');  
      }
    }
  }

  identify(callback) {
    this.log(`identifying: ${this.name}`);
    callback();
  }

  getState(callback) {
    this.log(`fetching state for: ${this.name}`);
    this.client.fetchState(this.entity_id, (data) => {
      if (data) {
        callback(null, this.transformData(data));
      } else {
        callback(communicationError);
      }
    });
  }
  
  getpm10(callback) {
    this.client.fetchState(this.aqi, (data) => {
      if (data) {
        callback(null, parseFloat(data.state));
      } else {
        callback(communicationError);
      }
    });
  }  

  getBatteryLevel(callback) {
    this.client.fetchState(this.batterySource, (data) => {
      if (data) {
        callback(null, parseFloat(data.state));
      } else {
        callback(communicationError);
      }
    });
  }
  getChargingState(callback) {
    if (this.batterySource && this.chargingSource) {
      this.client.fetchState(this.chargingSource, (data) => {
        if (data) {
          callback(null, data.state.toLowerCase() === 'charging' ? 1 : 0);
        } else {
          callback(communicationError);
        }
      });
    } else {
      callback(null, 2);
    }
  }
  getLowBatteryStatus(callback) {
    this.client.fetchState(this.batterySource, (data) => {
      if (data) {
        callback(null, parseFloat(data.state) > 20 ? 0 : 1);
      } else {
        callback(communicationError);
      }
    });
  }
  getServices() {
    this.sensorService = new this.service(); // eslint-disable-line new-cap
    const informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, this.mfg)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serial);

    this.sensorService
      .getCharacteristic(this.characteristic)
      .setProps({ minValue: -50 })
      .on('get', this.getState.bind(this));

    if (this.batterySource) {
      this.batteryService = new Service.BatteryService();
      this.batteryService
        .getCharacteristic(Characteristic.BatteryLevel)
        .setProps({ maxValue: 100, minValue: 0, minStep: 1 })
        .on('get', this.getBatteryLevel.bind(this));
      this.batteryService
        .getCharacteristic(Characteristic.ChargingState)
        .setProps({ maxValue: 2 })
        .on('get', this.getChargingState.bind(this));
      this.batteryService
        .getCharacteristic(Characteristic.StatusLowBattery)
        .on('get', this.getLowBatteryStatus.bind(this));
      return [informationService, this.batteryService, this.sensorService];
    }
    return [informationService, this.sensorService];
  }
}

function HomeAssistantSensorFactory(log, data, client) {
  if (!data.attributes) {
    return null;
  }
  let service;
  let characteristic;
  let transformData;
  let characteristic2;
  let transformData2; 
  if (data.attributes.unit_of_measurement === '°C'
      || data.attributes.unit_of_measurement === '℃'
      || data.attributes.unit_of_measurement === '°F'
      || data.attributes.unit_of_measurement === '℉') {
    service = Service.TemperatureSensor;
    characteristic = Characteristic.CurrentTemperature;
    transformData = function transformData(dataToTransform) { // eslint-disable-line no-shadow
      let value = parseFloat(dataToTransform.state);
      // HomeKit only works with Celsius internally
      if (dataToTransform.attributes.unit_of_measurement === '°F'
          || dataToTransform.attributes.unit_of_measurement === '℉') {
        value = (value - 32) / 1.8;
      }
      return value;
    };
  } else if (data.attributes.unit_of_measurement === '%' && (data.entity_id.includes('humidity') || data.attributes.homebridge_sensor_type === 'humidity')) {
    service = Service.HumiditySensor;
    characteristic = Characteristic.CurrentRelativeHumidity;
  } else if ((typeof data.attributes.unit_of_measurement === 'string' && data.attributes.unit_of_measurement.toLowerCase() === 'lux') || data.attributes.homebridge_sensor_type === 'light') {
    service = Service.LightSensor;
    characteristic = Characteristic.CurrentAmbientLightLevel;
    transformData = function transformData(dataToTransform) { // eslint-disable-line no-shadow
      return Math.max(0.0001, parseFloat(dataToTransform.state));
    };
  } else if (typeof data.attributes.unit_of_measurement === 'string' && data.attributes.unit_of_measurement.toLowerCase() === 'ppm' && (data.entity_id.includes('co2') || data.attributes.homebridge_sensor_type === 'co2')) {
    service = Service.CarbonDioxideSensor;
    characteristic = Characteristic.CarbonDioxideLevel;
  } else if ((typeof data.attributes.unit_of_measurement === 'string' && data.attributes.unit_of_measurement.toLowerCase() === '㎍/㎥') || data.attributes.homebridge_sensor_type === 'pm10density') {
    service = Service.AirQualitySensor;
    characteristic2 = Characteristic.PM2_5Density;
    transformData2 = function transformData2(dataToTransform) {
      const value2 = parseFloat(dataToTransform.state);
      return value2;
    };    
    characteristic = Characteristic.AirQuality;
    transformData = function transformData(dataToTransform) { // eslint-disable-line no-shadow
      const value = parseFloat(dataToTransform.state);
      if (value <= 30) {
        return 1;
      } else if (value >= 31 && value <= 70) {
        return 2;
      } else if (value >= 71 && value <= 100) {
        return 3;
      } else if (value >= 101 && value <= 150) {
        return 4;
      } else if (value >= 151) {
        return 5;
      }
      return 0;
    };    
  } else if ((typeof data.attributes.unit_of_measurement === 'string' && data.attributes.unit_of_measurement.toLowerCase() === 'aqi') || data.attributes.homebridge_sensor_type === 'air_quality') {
    service = Service.AirQualitySensor;
    characteristic = Characteristic.AirQuality;
    transformData = function transformData(dataToTransform) { // eslint-disable-line no-shadow
      const value = parseFloat(dataToTransform.state);
      if (value <= 30) {
        return 1;
      } else if (value >= 31 && value <= 70) {
        return 2;
      } else if (value >= 71 && value <= 100) {
        return 3;
      } else if (value >= 101 && value <= 150) {
        return 4;
      } else if (value >= 151) {
        return 5;
      }
      return 0;
    };
  } else {
    return null;
  }

  return new HomeAssistantSensor(log, data, client, service, characteristic, transformData, characteristic2, transformData2);
}

function HomeAssistantSensorPlatform(oService, oCharacteristic, oCommunicationError) {
  Service = oService;
  Characteristic = oCharacteristic;
  communicationError = oCommunicationError;

  return HomeAssistantSensorFactory;
}

module.exports = HomeAssistantSensorPlatform;

module.exports.HomeAssistantSensorFactory = HomeAssistantSensorFactory;

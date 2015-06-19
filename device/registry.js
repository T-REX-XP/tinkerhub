var EventEmitter = require('events').EventEmitter;
var util = require('util');
var debug = require('debug')('th.devices');

function Registry(net) {
    EventEmitter.call(this);

    this._net = net;

    this._localDevices = {};
    this._devices = {};

    net.on('message', this._onmessage.bind(this));
    net.on('peerConnected', this._sendDeviceListTo.bind(this));
    net.on('peerDisconnected', this._removeDevicesForPeer.bind(this));
}

util.inherits(Registry, EventEmitter);

Registry.prototype._toPublicDevice = function(device) {
    return device;
}

Registry.prototype._onmessage = function(event) {
    switch(event.type) {
        case 'device':
            this._registerDevice(event.payload);
            break;
        case 'device:disconnected':
            this._removeDevice(event.payload);
            break;
    }
};

Registry.prototype._registerDevice = function(device) {
    // Skip registering if we have this device locally
    if(this._localDevices[device.id]) return;

    var registered = this._devices[device.id];
    if(registered) {
        // Check if we should update our previous registration
        if(registered.owner === registered.peer &&
            device.peer !== registered.peer)
        {
            // The device is reachable via its owner, don't update from this peer
            return;
        }
    }

    debug('Found device ' + device.id + ' via peer ' + device.peer);

    this._devices[device.id] = device;

    this.emit('deviceConnected', this._toPublicDevice(device));
};

Registry.prototype.register = function(id, methods) {
    var self = this._net.id;
    var device = this._localDevices[id] = this._devices[id] = {
        id: id,
        peer: self,
        owner: self,
        methods: methods
    };

    debug('New local device ' + id);

    this._net.broadcast('device', device);

    this.emit('deviceConnected', this._toPublicDevice(device));
};

Registry.prototype._removeDevice = function(device) {
    var registered = this._devices[id];
    if(registered.peer != device.peer) return;

    debug('Device ' + device.id + ' is no longer available');

    delete this._devices[device.id];
    this.emit('deviceDisconnected', this._toPublicDevice(device));
};

Registry.prototype._sendDeviceListTo = function(id) {
    debug('Telling peer ' + id + ' about our devices');

    Object.keys(this._localDevices).forEach(function(dId) {
        var device = this._devices[dId];

        // Skip sending device if we think it comes from the peer
        if(device.peer === id || device.owner === id) return;

        this._net.send(id, 'device', device);
    }.bind(this));
};

Registry.prototype._removeDevicesForPeer = function(peer) {
    console.log('removing for ', peer);
    Object.keys(this._devices).forEach(function(id) {
        var device = this._devices[id];
        if(device.peer == peer) {
            debug('Device ' + device.id + ' is no longer available');

            delete this._devices[device.id];
            this.emit('deviceDisconnected', this._toPublicDevice(device));
        }
    }.bind(this));
};

module.exports = function(net) {
    return new Registry(net);
};

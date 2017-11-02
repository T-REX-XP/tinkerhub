'use strict';

const debug = require('debug')('th:services');
const EventEmitter = require('../events').EventEmitter;

const RemoteService = require('./service-remote');
const LocalService = require('./service-local');

/*
 * Distributed service registry that provides access to both local and remote
 * services in a seamless way.
 */
module.exports = class Services {
	constructor(network) {
		this.network = network;
		this.events = new EventEmitter();

		this.services = new Map();

		network.on('message', this._handleMessage.bind(this));
		network.on('node:available', this._handleNodeAvailable.bind(this));
		network.on('node:unavailable', this._handleNodeUnavailable.bind(this));
	}

	_handleNodeAvailable(node) {
		/*
		 * When we connect to a new node, send the node all of the local
		 * services we provide.
		 */
		for(const service of this.services.values()) {
			if(service instanceof LocalService) {
				node.send('service:available', {
					id: service.id,
					distance: service.bestDistance
				});
			}
		}
	}

	_handleNodeUnavailable(node) {
		for(const service of this.services.values()) {
			if(service instanceof RemoteService && service.node.id === node.id) {
				this._handleServiceUnavailable0(service);
			}
		}
	}

	on(event, listener) {
		this.events.on(event, listener);
	}

	off(event, listener) {
		this.events.off(event, listener);
	}

	register(id, instance) {
		const service = new LocalService(this, id, instance);
		this.services.set(id, service);
		this.network.broadcast('service:available', service.definition);

		this.events.emit('available', service);

		return service;
	}

	remove(id) {
		const service = this.services.get(id);
		if(! service || ! (service instanceof LocalService)) return;

		this.services.delete(service.id);
		this.network.broadcast('service:unavailable', service.definition);

		this.events.emit('unavailable', service);
	}

	_handleMessage(msg) {
		switch(msg.type) {
			case 'service:available':
				this._handleServiceAvailable(msg.returnPath, msg.payload);
				break;
			case 'service:unavailable':
				this._handleServiceUnavailable(msg.returnPath, msg.payload);
				break;
			case 'service:subscribe':
				this._handleServiceSubscribe(msg.returnPath, msg.payload);
				break;
			case 'service:unsubscribe':
				this._handleServiceUnsubscribe(msg.returnPath, msg.payload);
				break;
			case 'service:event':
				this._handleServiceEvent(msg.returnPath, msg.payload);
				break;
			case 'service:invoke':
				this._handleServiceInvoke(msg.returnPath, msg.payload);
				break;
			case 'service:invoke-result':
				this._handleServiceInvokeResult(msg.returnPath, msg.payload);
				break;
		}
	}

	_handleServiceAvailable(node, data) {
		debug('Service', data.id, 'available via', node);

		let service = this.services.get(data.id);
		if(! service) {
			service = new RemoteService(this, node, data);
			this.services.set(data.id, service);

			this.events.emit('available', service);
		} else {
			service.updateDefinition(data);
		}
	}

	_handleServiceUnavailable(node, data) {
		debug('Service', data.id, 'is no longer available via', node);

		// Get the service and protect against unknown service
		let service = this.services.get(data.id);
		if(! (service instanceof RemoteService)) return;

		this._handleServiceUnavailable0(service);
	}

	_handleServiceUnavailable0(service) {
		debug(service.id, 'is no longer available');
		this.services.delete(service.id);
		this.events.emit('unavailable', service);
	}

	_handleServiceSubscribe(node, message) {
		const service = this.services.get(message.service);
		if(! (service instanceof LocalService)) return;

		service.subscribe(node);
	}

	_handleServiceUnsubscribe(node, message) {
		const service = this.services.get(message.service);
		if(! (service instanceof LocalService)) return;

		service.unsubscribe(node);
	}

	_handleServiceEvent(node, message) {
		const service = this.services.get(message.service);
		if(! (service instanceof RemoteService)) return;

		service.receiveEvent(message.name, message.payload);
	}

	_handleServiceInvoke(node, message) {
		const service = this.services.get(message.service);
		if(! (service instanceof LocalService)) {
			debug('Unknown device, sending back failure');
			node.send('service:invoke-result', {
				service: message.service,
				seq: message.seq,
				error: 'Unknown service'
			});
		} else {
			debug('Invoking', message.action, 'on', service);
			service.call(message.action, message.arguments)
				.then(value => {
					node.send('service:invoke-result', {
						service: message.service,
						seq: message.seq,
						result: value
					});
				})
				.catch(err => {
					node.send('service:invoke-result', {
						service: message.service,
						seq: message.seq,
						error: String(err)
					});
				});
		}
	}

	_handleServiceInvokeResult(node, message) {
		const service = this.services.get(message.service);
		if(! (service instanceof RemoteService)) return;

		service.receiveReply(message);
	}
};

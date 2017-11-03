'use strict';

/*
 * Machine local transport. Instances of Tinkerhub on the same machine
 * connect through a local Unix or Windows socket.
 */
const debug = require('debug')('th:net:local');

const EventEmitter = require('events');
const path = require('path');
const eos = require('end-of-stream');

const storage = require('../storage');
const leader = require('unix-socket-leader');
const amp = require('amp');
const Parser = amp.Stream;

module.exports = class MachineLocal {
	constructor(id) {
		this.events = new EventEmitter(this);

		this.id = id;
		this.peers = [];
	}

	on(event, handler) {
		this.events.on(event, handler);
	}

	join() {
		debug('Starting machine local transport');

		const id = path.join(storage.appdata, 'local-net');
		this.leader = leader(id);
		this.leader.on('leader', () => {
			// Emit an event when this node becomes the leader
			this.events.emit('leader');
		});

		const handlePeer = sock => {
			new Peer(this, sock).negotiate()
				.then(peer => {
					if(peer.id === this.id) {
						// This peer points to ourself, ignore it
						return;
					}

					// Keep track of this peer
					this.peers.push(peer);
					peer.on('disconnected', () => {
						const idx = this.peers.indexOf(peer);
						if(idx >= 0) {
							this.peers.slice(idx, 1);
						}
					});

					// Emit that we found a peer
					this.events.emit('peer:connected', peer);
				})
				.catch((err) => {
					debug('Connecting to peer failed, ignoring. Error was:', err);
				});
		};

		this.leader.on('connection', handlePeer);
		this.leader.on('client', handlePeer);
	}

	leave() {
		for(const peer of this.peers) {
			peer.disconnect();
		}

		this.leader.close();
	}

	broadcast(data) {
		for(const peer of this.peers) {
			peer.send(data);
		}
	}
}

class Peer {
	constructor(transport, client) {
		this.transport = transport;
		this.events = new EventEmitter();
		this.client = client;

		client.on('error', err => {
			debug(this, 'received an error', err);
		});

		// Setup error and disconnected events
		eos(client, (err) => {
			if(typeof err !== 'undefined') {
				this.events.emit('error', err);
			}

			this.events.emit('disconnected');
		});

		// Setup the parser for incoming messages
		const parser = new Parser();
		client.pipe(parser);

		parser.on('data', buf => {
			const data = amp.decode(buf);
			const type = data[0].toString();
			const payload = JSON.parse(data[1].toString());

			debug('Incoming', type, 'with payload', payload);
			this.events.emit(type, payload);
		});

		// Reply to hello messages with our metadata
		this.events.on('hello', msg => {
			this.id = msg.id;
			this.version = msg.version;

			this.write('metadata', {
				id: this.transport.id,
				version: 1
			});
		});
	}

	negotiate() {
		return new Promise((resolve, reject) => {
			// Listen for metadata about the other peer
			this.events.once('metadata', md => {
				this.id = md.id;
				this.version = md.version;

				clearTimeout(timeout);
				resolve(this);
			});

			// Write the hello message
			this.write('hello', {
				id: this.transport.id,
				version: 1
			});

			// Give the negotiation a second to complete
			const timeout = setTimeout(reject, 1000);
		});
	}

	on(event, handler) {
		this.events.on(event, handler);
	}

    disconnect() {
		this.client.destroy();
	}

	send(payload) {
		this.write('message', payload);
	}

	write(type, payload) {
		const data = amp.encode([
			Buffer.from(type),
			Buffer.from(JSON.stringify(payload))
		]);
		this.client.write(data);
    }

	inspect() {
		return 'Local[' +  this.id + ']';
	}
}
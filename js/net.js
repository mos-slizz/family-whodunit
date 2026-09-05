/* Family Whodunit — realtime relay over public MQTT brokers (WebSockets). No backend. */
(function () {
  const FW = window.FW || (window.FW = {});
  FW.BROKERS = [
    { name: 'EMQX',      url: 'wss://broker.emqx.io:8084/mqtt' },
    { name: 'HiveMQ',    url: 'wss://broker.hivemq.com:8884/mqtt' },
    { name: 'Mosquitto', url: 'wss://test.mosquitto.org:8081' }
  ];
  FW.PREFIX = 'fwdunit1';
  FW.topic = (room, rest) => FW.PREFIX + '/' + room + '/' + rest;
  FW.ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  FW.makeRoomCode = () => Array.from({ length: 4 }, () => FW.ROOM_CHARS[Math.floor(Math.random() * FW.ROOM_CHARS.length)]).join('');
  FW.randId = (n) => Array.from({ length: n || 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

  // connect(brokerIdx, handlers) → Promise<client>. Rejects if the broker cannot be reached in time.
  FW.connect = function (brokerIdx, handlers, timeoutMs) {
    return new Promise((resolve, reject) => {
      const b = FW.BROKERS[brokerIdx];
      let settled = false;
      const client = mqtt.connect(b.url, { clientId: 'fw_' + FW.randId(10), keepalive: 30, reconnectPeriod: 2000, connectTimeout: timeoutMs || 8000, clean: true });
      const timer = setTimeout(() => { if (!settled) { settled = true; try { client.end(true); } catch (e) {} reject(new Error('timeout')); } }, timeoutMs || 8000);
      client.on('connect', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(client); } if (handlers.onConnect) handlers.onConnect(); });
      client.on('reconnect', () => handlers.onReconnect && handlers.onReconnect());
      client.on('offline', () => handlers.onOffline && handlers.onOffline());
      client.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); try { client.end(true); } catch (x) {} reject(e); } });
      client.on('message', (topic, payload) => {
        let msg; try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
        if (handlers.onMessage) handlers.onMessage(topic, msg);
      });
    });
  };
  FW.pub = function (client, topic, obj, retain) {
    try { client.publish(topic, JSON.stringify(obj), { qos: 0, retain: !!retain }); } catch (e) {}
  };
})();

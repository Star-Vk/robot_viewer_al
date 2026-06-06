import { Ros, Topic } from 'roslib';

const JOINT_STATE_TYPE = 'sensor_msgs/JointState';

function formatError(error) {
    if (!error) {
        return 'ROS bridge connection error';
    }

    if (typeof error === 'string') {
        return error;
    }

    return error.message || error.type || 'ROS bridge connection error';
}

export class RosbridgeClient {
    constructor() {
        this.ros = null;
        this.url = '';
        this.status = 'disconnected';
        this.statusMessage = 'Disconnected';
        this.subscriptions = new Map();
        this.publishers = new Map();
        this.statusListeners = new Set();
    }

    onStatusChanged(callback) {
        if (typeof callback !== 'function') {
            return () => {};
        }

        this.statusListeners.add(callback);
        return () => this.statusListeners.delete(callback);
    }

    emitStatus(status, message = '') {
        this.status = status;
        this.statusMessage = message || status;
        this.statusListeners.forEach(callback => callback(this.getConnectionStatus()));
    }

    async connect(url) {
        const nextUrl = String(url || '').trim();
        if (!nextUrl) {
            throw new Error('ROS Bridge URL is required');
        }

        if (this.ros?.isConnected && this.url === nextUrl) {
            this.emitStatus('connected', 'Connected');
            return this.getConnectionStatus();
        }

        this.disconnect({ silent: true });
        this.url = nextUrl;
        this.ros = new Ros();
        this.emitStatus('connecting', `Connecting to ${nextUrl}`);

        return new Promise((resolve, reject) => {
            let settled = false;
            const timeoutId = window.setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                this.emitStatus('error', 'Connection timed out');
                this.ros?.close();
                reject(new Error('Connection timed out'));
            }, 5000);

            const cleanup = () => {
                window.clearTimeout(timeoutId);
                this.ros?.off('connection', handleConnection);
                this.ros?.off('error', handleError);
                this.ros?.off('close', handleInitialClose);
            };

            const handleConnection = () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                this.attachPersistentHandlers();
                this.emitStatus('connected', 'Connected');
                resolve(this.getConnectionStatus());
            };

            const handleError = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                const message = formatError(error);
                this.emitStatus('error', message);
                reject(new Error(message));
            };

            const handleInitialClose = () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                this.emitStatus('disconnected', 'Disconnected');
                reject(new Error('Connection closed'));
            };

            this.ros.once('connection', handleConnection);
            this.ros.once('error', handleError);
            this.ros.once('close', handleInitialClose);

            Promise.resolve(this.ros.connect(nextUrl)).catch(error => {
                handleError(error);
            });
        });
    }

    attachPersistentHandlers() {
        if (!this.ros) {
            return;
        }

        this.ros.on('close', () => {
            this.subscriptions.clear();
            this.publishers.clear();
            this.emitStatus('disconnected', 'Disconnected');
        });

        this.ros.on('error', (error) => {
            this.emitStatus('error', formatError(error));
        });
    }

    disconnect(options = {}) {
        const { silent = false } = options;

        this.unsubscribeAll();
        this.unadvertiseAll();

        if (this.ros) {
            this.ros.close();
            this.ros = null;
        }

        if (!silent) {
            this.emitStatus('disconnected', 'Disconnected');
        }
    }

    subscribeJointState(topicName, callback, key = topicName) {
        const normalizedTopic = String(topicName || '').trim();
        if (!normalizedTopic) {
            throw new Error('JointState topic is required');
        }
        if (!this.ros?.isConnected) {
            throw new Error('ROS bridge is not connected');
        }

        this.unsubscribeJointState(key);

        const topic = new Topic({
            ros: this.ros,
            name: normalizedTopic,
            messageType: JOINT_STATE_TYPE
        });

        topic.subscribe(callback);
        this.subscriptions.set(key, { topic, callback, topicName: normalizedTopic });
        return () => this.unsubscribeJointState(key);
    }

    unsubscribeJointState(key) {
        const subscription = this.subscriptions.get(key);
        if (!subscription) {
            return;
        }

        subscription.topic.unsubscribe(subscription.callback);
        this.subscriptions.delete(key);
    }

    unsubscribeAll() {
        Array.from(this.subscriptions.keys()).forEach(key => this.unsubscribeJointState(key));
    }

    publishJointState(topicName, jointState) {
        const normalizedTopic = String(topicName || '').trim();
        if (!normalizedTopic || !this.ros?.isConnected) {
            return false;
        }

        let publisher = this.publishers.get(normalizedTopic);
        if (!publisher) {
            publisher = new Topic({
                ros: this.ros,
                name: normalizedTopic,
                messageType: JOINT_STATE_TYPE
            });
            this.publishers.set(normalizedTopic, publisher);
        }

        publisher.publish(jointState);
        return true;
    }

    unadvertiseJointState(topicName) {
        const normalizedTopic = String(topicName || '').trim();
        const publisher = this.publishers.get(normalizedTopic);
        if (!publisher) {
            return;
        }

        publisher.unadvertise();
        this.publishers.delete(normalizedTopic);
    }

    unadvertiseAll() {
        Array.from(this.publishers.keys()).forEach(topic => this.unadvertiseJointState(topic));
    }

    getConnectionStatus() {
        return {
            status: this.status,
            message: this.statusMessage,
            url: this.url,
            connected: this.ros?.isConnected || false
        };
    }
}

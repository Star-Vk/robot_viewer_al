import {
    DEFAULT_JOINT_STATE_MAPPING_CONFIG,
    cloneJointStateMappingConfig,
    normalizeJointStateMappingConfig,
    parseJointStateMappingText,
    resolveJointStateMapping,
    stringifyJointStateMappingConfig
} from '../utils/jointMappingUtils.js';

export const DEFAULT_SIM_STREAM_CONFIG = {
    rosbridgeUrl: 'ws://localhost:9090',
    targetJointTopic: '/openarm/target_joint_states',
    simJointTopic: '/openarm/sim/joint_states',
    currentJointTopic: '/openarm/current_joint_states',
    simulationHz: 30
};

export const DEFAULT_LIVE_STREAM_CONFIG = {
    rosbridgeUrl: 'ws://localhost:9090',
    liveJointTopic: '/openarm/live/joint_states'
};

const STREAM_MODES = new Set(['sim', 'live']);
const INPUT_SUBSCRIPTION_KEY = 'openarm-joint-state-stream-input';

function cloneConfig(config) {
    return JSON.parse(JSON.stringify(config));
}

function normalizeTopic(value, fallback) {
    const topic = String(value || '').trim();
    return topic || fallback;
}

function normalizeHz(value, fallback = 30) {
    const hz = Number(value);
    if (!Number.isFinite(hz)) {
        return fallback;
    }
    return Math.max(1, Math.min(120, hz));
}

function getRosTimeNow() {
    const nowMs = Date.now();
    return {
        sec: Math.floor(nowMs / 1000),
        nanosec: (nowMs % 1000) * 1000000
    };
}

export class JointStateStreamController {
    constructor({ sceneManager, jointControlsUI, rosClient }) {
        this.sceneManager = sceneManager;
        this.jointControlsUI = jointControlsUI;
        this.rosClient = rosClient;

        this.currentMode = 'viewer';
        this.currentModel = null;
        this.currentFileName = '';
        this.isRunning = false;
        this.statusMessage = '';

        this.configs = {
            sim: cloneConfig(DEFAULT_SIM_STREAM_CONFIG),
            live: cloneConfig(DEFAULT_LIVE_STREAM_CONFIG)
        };

        this.mappingConfigs = {
            sim: cloneJointStateMappingConfig(DEFAULT_JOINT_STATE_MAPPING_CONFIG),
            live: cloneJointStateMappingConfig(DEFAULT_JOINT_STATE_MAPPING_CONFIG)
        };

        this.virtualJointState = new Map();
        this.initialJointState = new Map();
        this.publishTimer = null;
        this.listeners = new Set();
        this.stats = this.createEmptyStats();

        this.rosClient?.onStatusChanged(() => {
            if (this.isRunning && this.rosClient.getConnectionStatus().connected) {
                this.refreshTopicBindings();
            }
            this.emitChange();
        });
    }

    createEmptyStats() {
        return {
            lastMessageAt: null,
            messageTimes: [],
            messageHz: 0,
            mappedJointCount: 0,
            missingJointCount: 0,
            missingJoints: [],
            lastPublishedAt: null
        };
    }

    onChange(callback) {
        if (typeof callback !== 'function') {
            return () => {};
        }

        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    emitChange() {
        this.listeners.forEach(callback => callback(this.getStatus()));
    }

    setMode(mode) {
        const nextMode = STREAM_MODES.has(mode) ? mode : 'viewer';
        if (nextMode !== this.currentMode) {
            this.pause();
            this.currentMode = nextMode;
            this.stats = this.createEmptyStats();
        }

        if (nextMode === 'sim') {
            this.syncVirtualStateFromModel();
        }

        this.emitChange();
    }

    setModel(model, file = null) {
        this.currentModel = model || null;
        this.currentFileName = file?.name || model?.name || '';
        this.initializeModelJointState();

        if (this.isRunning) {
            this.refreshTopicBindings();
            this.publishCurrentState();
        }

        this.emitChange();
    }

    getMovableJoints() {
        if (!this.currentModel?.joints) {
            return [];
        }

        return Array.from(this.currentModel.joints.entries())
            .filter(([, joint]) => joint && joint.type !== 'fixed' && !joint.mimic);
    }

    hasMovableJoints() {
        return this.getMovableJoints().length > 0;
    }

    readCurrentJointStateMap() {
        const state = new Map();
        this.getMovableJoints().forEach(([name, joint]) => {
            const value = Number(joint.currentValue);
            state.set(name, Number.isFinite(value) ? value : 0);
        });
        return state;
    }

    initializeModelJointState() {
        const state = this.readCurrentJointStateMap();
        this.initialJointState = new Map(state);
        this.virtualJointState = new Map(state);
    }

    syncVirtualStateFromModel() {
        if (!this.currentModel) {
            this.virtualJointState.clear();
            return;
        }

        this.virtualJointState = this.readCurrentJointStateMap();
    }

    updateConfig(mode, partialConfig = {}) {
        if (!STREAM_MODES.has(mode)) {
            return;
        }

        if (mode === 'sim') {
            this.configs.sim = {
                ...this.configs.sim,
                rosbridgeUrl: normalizeTopic(partialConfig.rosbridgeUrl, this.configs.sim.rosbridgeUrl),
                targetJointTopic: normalizeTopic(partialConfig.targetJointTopic, this.configs.sim.targetJointTopic),
                simJointTopic: normalizeTopic(partialConfig.simJointTopic, this.configs.sim.simJointTopic),
                currentJointTopic: normalizeTopic(partialConfig.currentJointTopic, this.configs.sim.currentJointTopic),
                simulationHz: normalizeHz(partialConfig.simulationHz, this.configs.sim.simulationHz)
            };
        } else {
            this.configs.live = {
                ...this.configs.live,
                rosbridgeUrl: normalizeTopic(partialConfig.rosbridgeUrl, this.configs.live.rosbridgeUrl),
                liveJointTopic: normalizeTopic(partialConfig.liveJointTopic, this.configs.live.liveJointTopic)
            };
        }

        if (this.isRunning && this.currentMode === mode) {
            this.refreshTopicBindings();
            if (mode === 'sim') {
                this.startPublishTimer();
            }
        }

        this.emitChange();
    }

    setMappingFromText(mode, text) {
        if (!STREAM_MODES.has(mode)) {
            return;
        }

        this.mappingConfigs[mode] = parseJointStateMappingText(text);
        this.emitChange();
    }

    resetMapping(mode) {
        if (!STREAM_MODES.has(mode)) {
            return;
        }

        this.mappingConfigs[mode] = normalizeJointStateMappingConfig(DEFAULT_JOINT_STATE_MAPPING_CONFIG);
        this.emitChange();
    }

    getMappingText(mode) {
        return stringifyJointStateMappingConfig(this.mappingConfigs[mode] || DEFAULT_JOINT_STATE_MAPPING_CONFIG);
    }

    async connect(url) {
        const mode = STREAM_MODES.has(this.currentMode) ? this.currentMode : 'sim';
        this.updateConfig(mode, { rosbridgeUrl: url });
        await this.rosClient.connect(url);

        if (this.isRunning) {
            this.refreshTopicBindings();
        }

        this.emitChange();
    }

    disconnect() {
        this.pause();
        this.rosClient.disconnect();
        this.emitChange();
    }

    start(mode = this.currentMode) {
        if (!STREAM_MODES.has(mode)) {
            this.statusMessage = 'Select Sim or Live mode first';
            this.emitChange();
            return false;
        }

        this.currentMode = mode;

        if (!this.hasMovableJoints()) {
            this.statusMessage = 'Load a URDF/model with movable joints first';
            this.emitChange();
            return false;
        }

        if (mode === 'sim' && this.virtualJointState.size === 0) {
            this.syncVirtualStateFromModel();
        }

        this.isRunning = true;
        this.statusMessage = mode === 'sim' ? 'Simulation running' : 'Live view running';
        this.refreshTopicBindings();

        if (mode === 'sim') {
            this.startPublishTimer();
            this.publishCurrentState();
        } else {
            this.stopPublishTimer();
        }

        this.emitChange();
        return true;
    }

    pause() {
        if (!this.isRunning && !this.publishTimer) {
            return;
        }

        this.isRunning = false;
        this.stopPublishTimer();
        this.clearTopicBindings();
        this.statusMessage = 'Paused';
        this.emitChange();
    }

    refreshTopicBindings() {
        this.clearTopicBindings();

        const connection = this.rosClient.getConnectionStatus();
        if (!this.isRunning || !connection.connected || !STREAM_MODES.has(this.currentMode)) {
            return;
        }

        const topic = this.currentMode === 'sim'
            ? this.configs.sim.targetJointTopic
            : this.configs.live.liveJointTopic;

        try {
            this.rosClient.subscribeJointState(
                topic,
                message => this.handleJointStateMessage(message),
                INPUT_SUBSCRIPTION_KEY
            );
        } catch (error) {
            this.statusMessage = error.message;
        }
    }

    clearTopicBindings() {
        this.rosClient.unsubscribeJointState(INPUT_SUBSCRIPTION_KEY);
    }

    startPublishTimer() {
        this.stopPublishTimer();

        const hz = normalizeHz(this.configs.sim.simulationHz, DEFAULT_SIM_STREAM_CONFIG.simulationHz);
        this.publishTimer = window.setInterval(() => {
            if (this.isRunning && this.currentMode === 'sim') {
                this.publishCurrentState();
            }
        }, Math.round(1000 / hz));
    }

    stopPublishTimer() {
        if (this.publishTimer) {
            window.clearInterval(this.publishTimer);
            this.publishTimer = null;
        }
    }

    handleJointStateMessage(message) {
        const names = Array.isArray(message?.name) ? message.name : [];
        const positions = Array.isArray(message?.position) ? message.position : [];
        const count = Math.min(names.length, positions.length);
        const mappedPose = {};
        const missingJoints = [];
        const mappingConfig = this.mappingConfigs[this.currentMode] || DEFAULT_JOINT_STATE_MAPPING_CONFIG;

        for (let index = 0; index < count; index += 1) {
            const resolved = resolveJointStateMapping(mappingConfig, names[index], positions[index]);
            if (!resolved) {
                continue;
            }

            const joint = this.currentModel?.joints?.get(resolved.urdfJoint);
            if (!joint || joint.type === 'fixed') {
                missingJoints.push(resolved.urdfJoint || resolved.sourceJoint);
                continue;
            }

            mappedPose[resolved.urdfJoint] = resolved.value;
            if (this.currentMode === 'sim') {
                this.virtualJointState.set(resolved.urdfJoint, resolved.value);
            }
        }

        this.recordMessageStats(Object.keys(mappedPose).length, missingJoints);

        if (Object.keys(mappedPose).length > 0) {
            this.applyJointValues(mappedPose);
        }

        this.emitChange();
    }

    recordMessageStats(mappedJointCount, missingJoints) {
        const now = Date.now();
        this.stats.lastMessageAt = now;
        this.stats.messageTimes.push(now);
        if (this.stats.messageTimes.length > 30) {
            this.stats.messageTimes.shift();
        }

        if (this.stats.messageTimes.length >= 2) {
            const first = this.stats.messageTimes[0];
            const last = this.stats.messageTimes[this.stats.messageTimes.length - 1];
            const durationSec = Math.max(0.001, (last - first) / 1000);
            this.stats.messageHz = (this.stats.messageTimes.length - 1) / durationSec;
        }

        this.stats.mappedJointCount = mappedJointCount;
        this.stats.missingJointCount = missingJoints.length;
        this.stats.missingJoints = missingJoints.slice(0, 20);
    }

    applyJointValues(jointValues) {
        if (!this.currentModel || !this.jointControlsUI) {
            return;
        }

        this.jointControlsUI.applyJointValues(this.currentModel, jointValues, {
            ignoreLimits: this.sceneManager?.ignoreLimits || false,
            applyConstraints: true,
            renderImmediate: false,
            updateMeasurements: true
        });
    }

    resetToInitialPose() {
        if (!this.currentModel || this.initialJointState.size === 0) {
            this.statusMessage = 'Load a model first';
            this.emitChange();
            return false;
        }

        this.virtualJointState = new Map(this.initialJointState);
        this.applyJointValues(Object.fromEntries(this.virtualJointState.entries()));
        this.publishCurrentState();
        this.statusMessage = 'Reset to URDF initial pose';
        this.emitChange();
        return true;
    }

    buildJointStateMessage() {
        const names = Array.from(this.virtualJointState.keys());
        const positions = names.map(name => {
            const value = Number(this.virtualJointState.get(name));
            return Number.isFinite(value) ? value : 0;
        });

        return {
            header: {
                stamp: getRosTimeNow(),
                frame_id: ''
            },
            name: names,
            position: positions,
            velocity: [],
            effort: []
        };
    }

    publishCurrentState() {
        if (this.currentMode !== 'sim' || this.virtualJointState.size === 0) {
            return false;
        }

        const message = this.buildJointStateMessage();
        const simPublished = this.rosClient.publishJointState(this.configs.sim.simJointTopic, message);
        const currentPublished = this.rosClient.publishJointState(this.configs.sim.currentJointTopic, message);

        if (simPublished || currentPublished) {
            this.stats.lastPublishedAt = Date.now();
        }

        return simPublished || currentPublished;
    }

    getConfig(mode) {
        return cloneConfig(this.configs[mode] || {});
    }

    getStatus(mode = this.currentMode) {
        const connection = this.rosClient.getConnectionStatus();
        const movableJoints = this.getMovableJoints();
        const lastMessageAgeMs = this.stats.lastMessageAt === null
            ? null
            : Date.now() - this.stats.lastMessageAt;

        return {
            mode,
            activeMode: this.currentMode,
            running: this.isRunning && this.currentMode === mode,
            statusMessage: this.statusMessage,
            connection,
            config: this.getConfig(mode),
            mappingConfig: cloneJointStateMappingConfig(this.mappingConfigs[mode] || DEFAULT_JOINT_STATE_MAPPING_CONFIG),
            hasModel: !!this.currentModel,
            modelName: this.currentFileName || this.currentModel?.name || 'Loaded model',
            movableJointCount: movableJoints.length,
            virtualJointCount: this.virtualJointState.size,
            lastMessageAgeMs,
            messageHz: this.stats.messageHz,
            mappedJointCount: this.stats.mappedJointCount,
            missingJointCount: this.stats.missingJointCount,
            missingJoints: [...this.stats.missingJoints],
            lastPublishedAt: this.stats.lastPublishedAt
        };
    }
}

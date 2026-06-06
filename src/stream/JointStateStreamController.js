import {
    DEFAULT_JOINT_STATE_MAPPING_CONFIG,
    cloneJointStateMappingConfig,
    normalizeJointStateMappingConfig,
    parseJointStateMappingText,
    resolveJointStateMapping,
    stringifyJointStateMappingConfig
} from '../utils/jointMappingUtils.js';

export const SIM_BACKENDS = {
    TARGET_JOINT_STATE: 'target_joint_state',
    FAKE_FORWARD_POSITION_CONTROLLER: 'fake_forward_position_controller'
};

const OPENARM_LEFT_URDF_JOINTS = [
    'openarm_left_joint1',
    'openarm_left_joint2',
    'openarm_left_joint3',
    'openarm_left_joint4',
    'openarm_left_joint5',
    'openarm_left_joint6',
    'openarm_left_joint7'
];

const OPENARM_RIGHT_URDF_JOINTS = [
    'openarm_right_joint1',
    'openarm_right_joint2',
    'openarm_right_joint3',
    'openarm_right_joint4',
    'openarm_right_joint5',
    'openarm_right_joint6',
    'openarm_right_joint7'
];

const OPENARMX_LEFT_ROS_JOINTS = [
    'openarmx_left_joint1',
    'openarmx_left_joint2',
    'openarmx_left_joint3',
    'openarmx_left_joint4',
    'openarmx_left_joint5',
    'openarmx_left_joint6',
    'openarmx_left_joint7'
];

const OPENARMX_RIGHT_ROS_JOINTS = [
    'openarmx_right_joint1',
    'openarmx_right_joint2',
    'openarmx_right_joint3',
    'openarmx_right_joint4',
    'openarmx_right_joint5',
    'openarmx_right_joint6',
    'openarmx_right_joint7'
];

export const DEFAULT_OPENARMX_JOINT_STATE_MAPPING_CONFIG = {
    name: 'openarmx-fake-controller-default',
    version: 1,
    source: 'joint_state',
    mappings: {
        openarmx_left_joint1: 'openarm_left_joint1',
        openarmx_left_joint2: 'openarm_left_joint2',
        openarmx_left_joint3: 'openarm_left_joint3',
        openarmx_left_joint4: 'openarm_left_joint4',
        openarmx_left_joint5: 'openarm_left_joint5',
        openarmx_left_joint6: 'openarm_left_joint6',
        openarmx_left_joint7: 'openarm_left_joint7',
        openarmx_right_joint1: 'openarm_right_joint1',
        openarmx_right_joint2: 'openarm_right_joint2',
        openarmx_right_joint3: 'openarm_right_joint3',
        openarmx_right_joint4: 'openarm_right_joint4',
        openarmx_right_joint5: 'openarm_right_joint5',
        openarmx_right_joint6: 'openarm_right_joint6',
        openarmx_right_joint7: 'openarm_right_joint7'
    }
};

export const DEFAULT_SIM_STREAM_CONFIG = {
    backend: SIM_BACKENDS.FAKE_FORWARD_POSITION_CONTROLLER,
    rosbridgeUrl: 'ws://localhost:9090',
    targetJointTopic: '/openarm/target_joint_states',
    simJointTopic: '/openarm/sim/joint_states',
    currentJointTopic: '/openarm/current_joint_states',
    jointStatesTopic: '/joint_states',
    leftControllerCommandTopic: '/left_forward_position_controller/commands',
    rightControllerCommandTopic: '/right_forward_position_controller/commands',
    simulationHz: 30
};

export const DEFAULT_LIVE_STREAM_CONFIG = {
    rosbridgeUrl: 'ws://localhost:9090',
    liveJointTopic: '/openarm/live/joint_states'
};

const STREAM_MODES = new Set(['sim', 'live']);
const TARGET_SUBSCRIPTION_KEY = 'openarm-target-joint-state-input';
const LEFT_COMMAND_SUBSCRIPTION_KEY = 'openarm-left-forward-position-command';
const RIGHT_COMMAND_SUBSCRIPTION_KEY = 'openarm-right-forward-position-command';

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

function normalizeSimBackend(value, fallback = SIM_BACKENDS.FAKE_FORWARD_POSITION_CONTROLLER) {
    return Object.values(SIM_BACKENDS).includes(value) ? value : fallback;
}

function getRosTimeNow() {
    const nowMs = Date.now();
    return {
        sec: Math.floor(nowMs / 1000),
        nanosec: (nowMs % 1000) * 1000000
    };
}

function getDefaultRosJointName(side, index) {
    return side === 'left'
        ? OPENARMX_LEFT_ROS_JOINTS[index]
        : OPENARMX_RIGHT_ROS_JOINTS[index];
}

function getDefaultUrdfJointName(side, index) {
    return side === 'left'
        ? OPENARM_LEFT_URDF_JOINTS[index]
        : OPENARM_RIGHT_URDF_JOINTS[index];
}

function parseMappingValue(sourceJoint, mappingValue) {
    if (typeof mappingValue === 'string') {
        return {
            rosJoint: sourceJoint,
            urdfJoint: mappingValue,
            sign: 1,
            scale: 1,
            offset: 0
        };
    }

    if (mappingValue && typeof mappingValue === 'object') {
        return {
            rosJoint: sourceJoint,
            urdfJoint: mappingValue.urdf_joint,
            sign: Number(mappingValue.sign) >= 0 ? 1 : -1,
            scale: Number.isFinite(Number(mappingValue.scale)) ? Number(mappingValue.scale) : 1,
            offset: Number.isFinite(Number(mappingValue.offset)) ? Number(mappingValue.offset) : 0
        };
    }

    return null;
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
            sim: {
                [SIM_BACKENDS.TARGET_JOINT_STATE]: cloneJointStateMappingConfig(DEFAULT_JOINT_STATE_MAPPING_CONFIG),
                [SIM_BACKENDS.FAKE_FORWARD_POSITION_CONTROLLER]: cloneJointStateMappingConfig(DEFAULT_OPENARMX_JOINT_STATE_MAPPING_CONFIG)
            },
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
            this.ensureFakeControllerVirtualJoints();
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
        this.ensureFakeControllerVirtualJoints();
    }

    syncVirtualStateFromModel() {
        if (!this.currentModel) {
            this.virtualJointState.clear();
            return;
        }

        this.virtualJointState = this.readCurrentJointStateMap();
        this.ensureFakeControllerVirtualJoints();
    }

    ensureFakeControllerVirtualJoints() {
        this.getFakeControllerMappingEntries().forEach(({ urdfJoint }) => {
            if (!urdfJoint || this.virtualJointState.has(urdfJoint)) {
                return;
            }

            const joint = this.currentModel?.joints?.get(urdfJoint);
            const value = Number(joint?.currentValue);
            this.virtualJointState.set(urdfJoint, Number.isFinite(value) ? value : 0);
        });
    }

    updateConfig(mode, partialConfig = {}) {
        if (!STREAM_MODES.has(mode)) {
            return;
        }

        if (mode === 'sim') {
            const previousBackend = this.configs.sim.backend;
            const nextBackend = normalizeSimBackend(partialConfig.backend, previousBackend);

            this.configs.sim = {
                ...this.configs.sim,
                backend: nextBackend,
                rosbridgeUrl: normalizeTopic(partialConfig.rosbridgeUrl, this.configs.sim.rosbridgeUrl),
                targetJointTopic: normalizeTopic(partialConfig.targetJointTopic, this.configs.sim.targetJointTopic),
                simJointTopic: normalizeTopic(partialConfig.simJointTopic, this.configs.sim.simJointTopic),
                currentJointTopic: normalizeTopic(partialConfig.currentJointTopic, this.configs.sim.currentJointTopic),
                jointStatesTopic: normalizeTopic(partialConfig.jointStatesTopic, this.configs.sim.jointStatesTopic),
                leftControllerCommandTopic: normalizeTopic(partialConfig.leftControllerCommandTopic, this.configs.sim.leftControllerCommandTopic),
                rightControllerCommandTopic: normalizeTopic(partialConfig.rightControllerCommandTopic, this.configs.sim.rightControllerCommandTopic),
                simulationHz: normalizeHz(partialConfig.simulationHz, this.configs.sim.simulationHz)
            };

            if (previousBackend !== nextBackend) {
                this.stats = this.createEmptyStats();
                this.ensureFakeControllerVirtualJoints();
            }
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

    getActiveSimBackend() {
        return normalizeSimBackend(this.configs.sim.backend);
    }

    getMappingConfig(mode) {
        if (mode === 'sim') {
            return this.mappingConfigs.sim[this.getActiveSimBackend()] || DEFAULT_JOINT_STATE_MAPPING_CONFIG;
        }

        return this.mappingConfigs[mode] || DEFAULT_JOINT_STATE_MAPPING_CONFIG;
    }

    setMappingFromText(mode, text) {
        if (!STREAM_MODES.has(mode)) {
            return;
        }

        if (mode === 'sim') {
            this.mappingConfigs.sim[this.getActiveSimBackend()] = parseJointStateMappingText(text);
            this.ensureFakeControllerVirtualJoints();
        } else {
            this.mappingConfigs[mode] = parseJointStateMappingText(text);
        }

        this.emitChange();
    }

    resetMapping(mode) {
        if (!STREAM_MODES.has(mode)) {
            return;
        }

        if (mode === 'sim') {
            const backend = this.getActiveSimBackend();
            this.mappingConfigs.sim[backend] = backend === SIM_BACKENDS.FAKE_FORWARD_POSITION_CONTROLLER
                ? normalizeJointStateMappingConfig(DEFAULT_OPENARMX_JOINT_STATE_MAPPING_CONFIG)
                : normalizeJointStateMappingConfig(DEFAULT_JOINT_STATE_MAPPING_CONFIG);
            this.ensureFakeControllerVirtualJoints();
        } else {
            this.mappingConfigs[mode] = normalizeJointStateMappingConfig(DEFAULT_JOINT_STATE_MAPPING_CONFIG);
        }

        this.emitChange();
    }

    getMappingText(mode) {
        return stringifyJointStateMappingConfig(this.getMappingConfig(mode));
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

        if (mode === 'sim') {
            if (this.virtualJointState.size === 0) {
                this.syncVirtualStateFromModel();
            }
            this.ensureFakeControllerVirtualJoints();
        }

        this.isRunning = true;
        this.statusMessage = this.getRunningStatusMessage(mode);
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

    getRunningStatusMessage(mode) {
        if (mode === 'sim') {
            return this.getActiveSimBackend() === SIM_BACKENDS.FAKE_FORWARD_POSITION_CONTROLLER
                ? 'Fake Forward Position Controller running'
                : 'Target JointState simulation running';
        }

        return 'Live view running';
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

        try {
            if (this.currentMode === 'sim') {
                this.refreshSimTopicBindings();
                return;
            }

            this.rosClient.subscribeJointState(
                this.configs.live.liveJointTopic,
                message => this.handleJointStateMessage(message),
                TARGET_SUBSCRIPTION_KEY
            );
        } catch (error) {
            this.statusMessage = error.message;
        }
    }

    refreshSimTopicBindings() {
        if (this.getActiveSimBackend() === SIM_BACKENDS.TARGET_JOINT_STATE) {
            this.rosClient.subscribeJointState(
                this.configs.sim.targetJointTopic,
                message => this.handleJointStateMessage(message),
                TARGET_SUBSCRIPTION_KEY
            );
            return;
        }

        this.rosClient.subscribeFloat64MultiArray(
            this.configs.sim.leftControllerCommandTopic,
            message => this.handleForwardPositionCommand('left', message),
            LEFT_COMMAND_SUBSCRIPTION_KEY
        );

        this.rosClient.subscribeFloat64MultiArray(
            this.configs.sim.rightControllerCommandTopic,
            message => this.handleForwardPositionCommand('right', message),
            RIGHT_COMMAND_SUBSCRIPTION_KEY
        );
    }

    clearTopicBindings() {
        this.rosClient.unsubscribeTopic(TARGET_SUBSCRIPTION_KEY);
        this.rosClient.unsubscribeTopic(LEFT_COMMAND_SUBSCRIPTION_KEY);
        this.rosClient.unsubscribeTopic(RIGHT_COMMAND_SUBSCRIPTION_KEY);
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
        const mappingConfig = this.getMappingConfig(this.currentMode);

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
            this.publishCurrentState();
        }

        this.emitChange();
    }

    handleForwardPositionCommand(side, message) {
        const data = Array.isArray(message?.data) ? message.data : [];
        const mappedPose = {};
        const missingJoints = [];

        for (let index = 0; index < 7; index += 1) {
            const value = Number(data[index]);
            if (!Number.isFinite(value)) {
                continue;
            }

            const urdfJoint = this.getFakeCommandUrdfJointName(side, index);
            const joint = this.currentModel?.joints?.get(urdfJoint);
            if (!joint || joint.type === 'fixed') {
                missingJoints.push(urdfJoint || getDefaultUrdfJointName(side, index));
                continue;
            }

            mappedPose[urdfJoint] = value;
            this.virtualJointState.set(urdfJoint, value);
        }

        this.recordMessageStats(Object.keys(mappedPose).length, missingJoints);

        if (Object.keys(mappedPose).length > 0) {
            this.applyJointValues(mappedPose);
            this.publishCurrentState();
        }

        this.emitChange();
    }

    getFakeCommandUrdfJointName(side, index) {
        const rosJoint = getDefaultRosJointName(side, index);
        const entry = this.getFakeControllerMappingEntries().find(item => item.rosJoint === rosJoint);
        return entry?.urdfJoint || getDefaultUrdfJointName(side, index);
    }

    getFakeControllerMappingEntries() {
        const config = normalizeJointStateMappingConfig(
            this.mappingConfigs.sim[SIM_BACKENDS.FAKE_FORWARD_POSITION_CONTROLLER] || DEFAULT_OPENARMX_JOINT_STATE_MAPPING_CONFIG
        );

        const rawEntries = Object.entries(config.mappings)
            .map(([sourceJoint, mappingValue]) => parseMappingValue(sourceJoint, mappingValue))
            .filter(entry => entry?.rosJoint && entry?.urdfJoint);

        if (rawEntries.length > 0) {
            return rawEntries;
        }

        return Object.entries(DEFAULT_OPENARMX_JOINT_STATE_MAPPING_CONFIG.mappings)
            .map(([sourceJoint, urdfJoint]) => parseMappingValue(sourceJoint, urdfJoint));
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
        this.ensureFakeControllerVirtualJoints();
        this.applyJointValues(Object.fromEntries(this.virtualJointState.entries()));
        this.publishCurrentState();
        this.statusMessage = 'Reset to URDF initial pose';
        this.emitChange();
        return true;
    }

    buildJointStateMessage(names, positions) {
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

    buildVirtualJointStateMessage() {
        const names = Array.from(this.virtualJointState.keys());
        const positions = names.map(name => this.getVirtualJointValue(name));
        return this.buildJointStateMessage(names, positions);
    }

    buildFakeControllerJointStateMessage() {
        const entries = this.getFakeControllerMappingEntries();
        const names = entries.map(entry => entry.rosJoint);
        const positions = entries.map(entry => this.mapUrdfValueToRosValue(entry, this.getVirtualJointValue(entry.urdfJoint)));
        return this.buildJointStateMessage(names, positions);
    }

    buildFakeControllerDebugJointStateMessage() {
        const entries = this.getFakeControllerMappingEntries();
        const names = entries.map(entry => entry.urdfJoint);
        const positions = entries.map(entry => this.getVirtualJointValue(entry.urdfJoint));
        return this.buildJointStateMessage(names, positions);
    }

    getVirtualJointValue(urdfJoint) {
        const value = Number(this.virtualJointState.get(urdfJoint));
        return Number.isFinite(value) ? value : 0;
    }

    mapUrdfValueToRosValue(entry, urdfValue) {
        const scale = Math.abs(entry.scale) > Number.EPSILON ? entry.scale : 1;
        return entry.sign * ((urdfValue - entry.offset) / scale);
    }

    publishCurrentState() {
        if (this.currentMode !== 'sim' || this.virtualJointState.size === 0) {
            return false;
        }

        if (this.getActiveSimBackend() === SIM_BACKENDS.FAKE_FORWARD_POSITION_CONTROLLER) {
            const jointStatesMessage = this.buildFakeControllerJointStateMessage();
            const simDebugMessage = this.buildFakeControllerDebugJointStateMessage();
            const jointStatesPublished = this.rosClient.publishJointState(this.configs.sim.jointStatesTopic, jointStatesMessage);
            const simDebugPublished = this.rosClient.publishJointState(this.configs.sim.simJointTopic, simDebugMessage);

            if (jointStatesPublished || simDebugPublished) {
                this.stats.lastPublishedAt = Date.now();
            }

            return jointStatesPublished || simDebugPublished;
        }

        const message = this.buildVirtualJointStateMessage();
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
        const simBackend = this.getActiveSimBackend();

        return {
            mode,
            activeMode: this.currentMode,
            running: this.isRunning && this.currentMode === mode,
            statusMessage: this.statusMessage,
            connection,
            config: this.getConfig(mode),
            simBackend,
            mappingConfig: cloneJointStateMappingConfig(this.getMappingConfig(mode)),
            hasModel: !!this.currentModel,
            modelName: this.currentFileName || this.currentModel?.name || 'Loaded model',
            movableJointCount: movableJoints.length,
            virtualJointCount: this.virtualJointState.size,
            lastMessageAgeMs,
            messageHz: this.stats.messageHz,
            mappedJointCount: this.stats.mappedJointCount,
            missingJointCount: this.stats.missingJointCount,
            missingJoints: [...this.stats.missingJoints],
            lastPublishedAt: this.stats.lastPublishedAt,
            fakeControllerJointNames: {
                ros: this.getFakeControllerMappingEntries().map(entry => entry.rosJoint),
                urdf: this.getFakeControllerMappingEntries().map(entry => entry.urdfJoint)
            }
        };
    }
}

import { parseActionCsvFile, parseActionCsvText } from '../actions/ActionLibraryParser.js';
import {
    buildJointMappingSummary,
    createActionJointMapping,
    DEFAULT_ACTION_JOINT_MAPPING_CONFIG,
    loadJointMappingConfigFromStorage,
    loadDefaultJointMappingConfigFromUrl,
    loadJointMappingConfigFromFile,
    saveJointMappingConfigToStorage,
    clearJointMappingConfigFromStorage
} from '../actions/Zqz1JointMapping.js';
import { i18n } from '../utils/i18n.js';

export class ActionPlaybackController {
    constructor(sceneManager, jointControlsUI, jointMapping = createActionJointMapping()) {
        this.sceneManager = sceneManager;
        this.jointControlsUI = jointControlsUI;
        this.jointMapping = jointMapping;

        this.actions = [];
        this.actionSources = new Map();
        this.currentModel = null;
        this.selectedActionId = null;

        this.defaultMappingConfig = DEFAULT_ACTION_JOINT_MAPPING_CONFIG;
        this.mappingConfig = DEFAULT_ACTION_JOINT_MAPPING_CONFIG;
        this.mappingSource = 'default';

        this.isPlaying = false;
        this.playbackRate = 1.0;
        this.currentTimeMs = 0;
        this.lastTickTimestamp = null;
        this.rafId = null;

        this.onActionsChanged = null;
        this.onPlaybackStateChanged = null;
        this.onStatusChanged = null;
        this.onMappingChanged = null;
    }

    async initialize() {
        let defaultConfig = DEFAULT_ACTION_JOINT_MAPPING_CONFIG;
        let defaultSource = 'fallback';

        try {
            defaultConfig = await loadDefaultJointMappingConfigFromUrl();
            defaultSource = 'default';
        } catch (error) {
            this.emitStatus(`${i18n.t('mappingLoadFailed')}: ${error.message}`, 'warn');
        }

        this.defaultMappingConfig = defaultConfig;

        const storedConfig = loadJointMappingConfigFromStorage();
        if (storedConfig) {
            this.applyMappingConfig(storedConfig, 'custom');
            this.emitStatus(i18n.t('mappingLoadedFromStorage'), 'info');
            return;
        }

        this.applyMappingConfig(defaultConfig, defaultSource);
    }

    setModel(model) {
        this.currentModel = model;

        if (!model && this.isPlaying) {
            this.stop({ resetToStart: false, silent: true });
        }

        if (model && this.getSelectedAction()) {
            this.applyCurrentPose();
        }

        this.emitActionsChanged();
        this.emitPlaybackState();
        this.emitMappingChanged();
    }

    async importActionFiles(files) {
        const inputFiles = Array.from(files || []).filter(file => file?.name?.toLowerCase().endsWith('.csv'));
        if (inputFiles.length === 0) {
            this.emitStatus(i18n.t('actionNoCsvFiles'), 'warn');
            return;
        }

        const importedActions = [];
        for (const file of inputFiles) {
            try {
                const action = await parseActionCsvFile(file, this.jointMapping);
                if (action.mappedRows === 0 || action.jointNames.length === 0) {
                    this.emitStatus(`${file.name}: ${i18n.t('actionNoMappedRows')}`, 'warn');
                    continue;
                }

                this.upsertAction(action);
                this.actionSources.set(action.id, {
                    id: action.id,
                    fileName: action.fileName,
                    sourceText: action.sourceText
                });
                importedActions.push(action);
            } catch (error) {
                this.emitStatus(`${file.name}: ${error.message}`, 'error');
            }
        }

        this.actions.sort((a, b) => a.name.localeCompare(b.name));

        if (importedActions.length > 0) {
            this.selectedActionId = importedActions[0].id;
            this.currentTimeMs = 0;
            this.applyCurrentPose();
            this.emitStatus(`${i18n.t('actionImported')}: ${importedActions.map(action => action.name).join(', ')}`, 'info');
        }

        this.emitActionsChanged();
        this.emitPlaybackState();
    }

    async importMappingFile(file) {
        if (!file) {
            return;
        }

        try {
            const config = await loadJointMappingConfigFromFile(file);
            this.applyMappingConfig(config, 'custom');
            saveJointMappingConfigToStorage(config);
            this.rebuildActionsFromCurrentMapping();
            this.emitStatus(`${i18n.t('mappingLoaded')}: ${file.name}`, 'info');
        } catch (error) {
            this.emitStatus(`${i18n.t('mappingLoadFailed')}: ${error.message}`, 'error');
        }
    }

    async resetMappingToDefault() {
        clearJointMappingConfigFromStorage();

        try {
            const defaultConfig = await loadDefaultJointMappingConfigFromUrl();
            this.defaultMappingConfig = defaultConfig;
            this.applyMappingConfig(defaultConfig, 'default');
        } catch (error) {
            this.defaultMappingConfig = DEFAULT_ACTION_JOINT_MAPPING_CONFIG;
            this.applyMappingConfig(DEFAULT_ACTION_JOINT_MAPPING_CONFIG, 'fallback');
            this.emitStatus(`${i18n.t('mappingLoadFailed')}: ${error.message}`, 'warn');
        }

        this.rebuildActionsFromCurrentMapping();
        this.emitStatus(i18n.t('mappingResetToDefault'), 'info');
    }

    selectAction(actionId) {
        if (!actionId || actionId === this.selectedActionId) {
            return;
        }

        this.selectedActionId = actionId;
        this.currentTimeMs = 0;

        if (this.isPlaying) {
            this.pause(true);
        }

        this.applyCurrentPose();
        this.emitActionsChanged();
        this.emitPlaybackState();
    }

    play() {
        const action = this.getSelectedAction();
        if (!action) {
            this.emitStatus(i18n.t('actionSelectPrompt'), 'warn');
            return;
        }

        if (!this.currentModel) {
            this.emitStatus(i18n.t('actionModelRequired'), 'warn');
            return;
        }

        const hasPlayableJoint = action.jointNames.some(jointName => this.currentModel?.joints?.has(jointName));
        if (!hasPlayableJoint) {
            this.emitStatus(i18n.t('actionNoMappedRows'), 'warn');
            return;
        }

        if (this.mappingSource !== 'custom') {
            const shouldContinue = window.confirm(i18n.t('mappingDefaultPlaybackConfirm'));
            if (!shouldContinue) {
                this.emitStatus(i18n.t('actionPlaybackCancelled'), 'info');
                return;
            }
        }

        if (this.currentTimeMs >= action.durationMs) {
            this.currentTimeMs = 0;
            this.applyCurrentPose();
        }

        this.isPlaying = true;
        this.lastTickTimestamp = null;
        this.requestNextFrame();
        this.emitPlaybackState();
    }

    pause(silent = false) {
        this.isPlaying = false;
        this.lastTickTimestamp = null;
        this.cancelAnimation();
        if (!silent) {
            this.emitPlaybackState();
        }
    }

    stop(options = {}) {
        const {
            resetToStart = true,
            silent = false
        } = options;

        this.isPlaying = false;
        this.lastTickTimestamp = null;
        this.cancelAnimation();

        if (resetToStart) {
            this.currentTimeMs = 0;
            this.applyCurrentPose();
        }

        if (!silent) {
            this.emitPlaybackState();
        }
    }

    seekNormalized(progress) {
        const action = this.getSelectedAction();
        if (!action) {
            return;
        }

        const clampedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
        this.currentTimeMs = action.durationMs * clampedProgress;
        this.applyCurrentPose();
        this.emitPlaybackState();
    }

    setPlaybackRate(rate) {
        const parsedRate = Number.parseFloat(rate);
        if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
            return;
        }

        this.playbackRate = parsedRate;
        this.emitPlaybackState();
    }

    destroy() {
        this.stop({ resetToStart: false, silent: true });
    }

    getSelectedAction() {
        return this.actions.find(action => action.id === this.selectedActionId) || null;
    }

    requestNextFrame() {
        this.cancelAnimation();
        this.rafId = window.requestAnimationFrame(timestamp => this.tick(timestamp));
    }

    cancelAnimation() {
        if (this.rafId) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    tick(timestamp) {
        if (!this.isPlaying) {
            return;
        }

        const action = this.getSelectedAction();
        if (!action) {
            this.pause();
            return;
        }

        if (this.lastTickTimestamp === null) {
            this.lastTickTimestamp = timestamp;
        } else {
            const deltaMs = (timestamp - this.lastTickTimestamp) * this.playbackRate;
            this.currentTimeMs = Math.min(action.durationMs, this.currentTimeMs + deltaMs);
            this.lastTickTimestamp = timestamp;
            this.applyCurrentPose();
            this.emitPlaybackState();
        }

        if (this.currentTimeMs >= action.durationMs) {
            this.isPlaying = false;
            this.lastTickTimestamp = null;
            this.cancelAnimation();
            this.emitStatus(i18n.t('actionPlaybackFinished'), 'info');
            this.emitPlaybackState();
            return;
        }

        this.requestNextFrame();
    }

    applyCurrentPose() {
        const action = this.getSelectedAction();
        if (!action || !this.currentModel || !this.jointControlsUI) {
            return;
        }

        const pose = this.interpolatePose(action, this.currentTimeMs);
        if (!pose) {
            return;
        }

        const playablePose = {};
        action.jointNames.forEach(jointName => {
            if (!this.currentModel?.joints?.has(jointName)) {
                return;
            }
            if (Number.isFinite(pose[jointName])) {
                playablePose[jointName] = pose[jointName];
            }
        });

        this.jointControlsUI.applyJointValues(this.currentModel, playablePose, {
            ignoreLimits: this.sceneManager?.ignoreLimits || false,
            applyConstraints: true,
            renderImmediate: false,
            updateMeasurements: true
        });
    }

    interpolatePose(action, timeMs) {
        if (!action.frames || action.frames.length === 0) {
            return null;
        }

        if (action.frames.length === 1 || timeMs <= action.frames[0].elapsedMs) {
            return { ...action.frames[0].jointPose };
        }

        const lastFrame = action.frames[action.frames.length - 1];
        if (timeMs >= lastFrame.elapsedMs) {
            return { ...lastFrame.jointPose };
        }

        const nextIndex = this.findUpperFrameIndex(action.frames, timeMs);
        const endFrame = action.frames[nextIndex];
        const startFrame = action.frames[nextIndex - 1];
        const duration = Math.max(1, endFrame.elapsedMs - startFrame.elapsedMs);
        const alpha = Math.max(0, Math.min(1, (timeMs - startFrame.elapsedMs) / duration));

        const pose = {};
        action.jointNames.forEach(jointName => {
            const startValue = startFrame.jointPose[jointName];
            const endValue = endFrame.jointPose[jointName];
            if (!Number.isFinite(startValue) && !Number.isFinite(endValue)) {
                return;
            }

            const safeStart = Number.isFinite(startValue) ? startValue : endValue;
            const safeEnd = Number.isFinite(endValue) ? endValue : safeStart;
            pose[jointName] = safeStart + (safeEnd - safeStart) * alpha;
        });

        return pose;
    }

    findUpperFrameIndex(frames, timeMs) {
        let low = 0;
        let high = frames.length - 1;

        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (frames[mid].elapsedMs <= timeMs) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        return low;
    }

    upsertAction(action) {
        const existingIndex = this.actions.findIndex(item => item.id === action.id);
        if (existingIndex >= 0) {
            this.actions.splice(existingIndex, 1, action);
        } else {
            this.actions.push(action);
        }
    }

    rebuildActionsFromCurrentMapping() {
        const rebuiltActions = [];

        this.actionSources.forEach(source => {
            try {
                const action = parseActionCsvText(source.sourceText, source.fileName, this.jointMapping);
                if (action.mappedRows === 0 || action.jointNames.length === 0) {
                    return;
                }
                rebuiltActions.push(action);
            } catch (error) {
                this.emitStatus(`${source.fileName}: ${error.message}`, 'error');
            }
        });

        const previousSelectedAction = this.selectedActionId;
        this.actions = rebuiltActions.sort((a, b) => a.name.localeCompare(b.name));

        if (!this.actions.find(action => action.id === previousSelectedAction)) {
            this.selectedActionId = this.actions[0]?.id || null;
            this.currentTimeMs = 0;
        } else {
            this.selectedActionId = previousSelectedAction;
        }

        this.applyCurrentPose();
        this.emitActionsChanged();
        this.emitPlaybackState();
    }

    applyMappingConfig(config, source) {
        this.mappingConfig = config;
        this.mappingSource = source;
        this.jointMapping.setConfig(config);
        this.emitMappingChanged();
    }

    getMappingSummary() {
        return buildJointMappingSummary(
            this.mappingConfig || DEFAULT_ACTION_JOINT_MAPPING_CONFIG,
            this.mappingSource
        );
    }

    getActionSummaries() {
        return this.actions.map(action => {
            const hasModel = !!this.currentModel?.joints;
            const missingJoints = hasModel
                ? action.jointNames.filter(jointName => !this.currentModel.joints.has(jointName))
                : [];
            const playableJointCount = hasModel
                ? action.jointNames.length - missingJoints.length
                : action.jointNames.length;

            return {
                id: action.id,
                name: action.name,
                fileName: action.fileName,
                frameCount: action.frameCount,
                durationMs: action.durationMs,
                jointCount: action.jointNames.length,
                playableJointCount,
                missingJointCount: missingJoints.length,
                missingJoints,
                mappedRows: action.mappedRows,
                unmappedRows: action.unmappedRows.length
            };
        });
    }

    emitActionsChanged() {
        this.onActionsChanged?.(this.getActionSummaries(), this.selectedActionId);
    }

    emitPlaybackState() {
        const action = this.getSelectedAction();
        this.onPlaybackStateChanged?.({
            isPlaying: this.isPlaying,
            playbackRate: this.playbackRate,
            currentTimeMs: this.currentTimeMs,
            durationMs: action?.durationMs || 0,
            selectedActionId: this.selectedActionId,
            hasModel: !!this.currentModel
        });
    }

    emitStatus(message, type = 'info') {
        this.onStatusChanged?.({ message, type });
    }

    emitMappingChanged() {
        this.onMappingChanged?.(this.getMappingSummary());
    }
}

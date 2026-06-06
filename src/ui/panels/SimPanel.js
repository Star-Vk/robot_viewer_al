import { DEFAULT_SIM_STREAM_CONFIG, SIM_BACKENDS } from '../../stream/JointStateStreamController.js';

function formatAge(ageMs) {
    if (ageMs === null || ageMs === undefined) {
        return '-';
    }

    if (ageMs < 1000) {
        return `${ageMs} ms`;
    }

    return `${(ageMs / 1000).toFixed(1)} s`;
}

function setValueIfIdle(input, value) {
    if (!input || document.activeElement === input) {
        return;
    }
    input.value = value;
}

function setSectionVisible(section, visible) {
    if (section) {
        section.style.display = visible ? 'flex' : 'none';
    }
}

export class SimPanel {
    constructor(controller) {
        this.controller = controller;
        this.container = null;
        this.updateTimer = null;
    }

    init() {
        this.container = document.getElementById('sim-panel-content');
        if (!this.container) {
            return;
        }

        this.render();
        this.bindEvents();
        this.controller.onChange(() => this.update());
        this.updateTimer = window.setInterval(() => this.update(), 500);
        this.update();
    }

    render() {
        this.container.innerHTML = `
            <div class="stream-panel">
                <div id="sim-safety-line" class="stream-safety">Arm Output: <strong>DISABLED</strong> · Hardware CAN: <strong>DISABLED</strong></div>

                <div class="stream-section">
                    <div class="stream-section-title">Current URDF / Model</div>
                    <div id="sim-model-status" class="stream-status-line"></div>
                </div>

                <div class="stream-section">
                    <label class="stream-field">
                        <span>Backend</span>
                        <select id="sim-backend-select" class="stream-input">
                            <option value="${SIM_BACKENDS.FAKE_FORWARD_POSITION_CONTROLLER}">Fake Forward Position Controller</option>
                            <option value="${SIM_BACKENDS.TARGET_JOINT_STATE}">Target JointState</option>
                        </select>
                    </label>
                </div>

                <div class="stream-section">
                    <label class="stream-field">
                        <span>ROS Bridge WebSocket URL</span>
                        <input id="sim-ros-url" class="stream-input" value="${DEFAULT_SIM_STREAM_CONFIG.rosbridgeUrl}">
                    </label>
                    <div class="stream-button-row">
                        <button id="sim-connect-btn" class="control-button">Connect</button>
                        <button id="sim-disconnect-btn" class="control-button">Disconnect</button>
                    </div>
                </div>

                <div id="sim-target-config-section" class="stream-section">
                    <label class="stream-field">
                        <span>Target JointState Topic</span>
                        <input id="sim-target-topic" class="stream-input" value="${DEFAULT_SIM_STREAM_CONFIG.targetJointTopic}">
                    </label>
                    <label class="stream-field">
                        <span>Sim Current JointState Publish Topic</span>
                        <input id="sim-publish-topic" class="stream-input" value="${DEFAULT_SIM_STREAM_CONFIG.simJointTopic}">
                    </label>
                    <label class="stream-field">
                        <span>Current JointState Topic for IK</span>
                        <input id="sim-current-topic" class="stream-input" value="${DEFAULT_SIM_STREAM_CONFIG.currentJointTopic}">
                    </label>
                </div>

                <div id="sim-fake-config-section" class="stream-section">
                    <label class="stream-field">
                        <span>Joint States Publish Topic</span>
                        <input id="sim-joint-states-topic" class="stream-input" value="${DEFAULT_SIM_STREAM_CONFIG.jointStatesTopic}">
                    </label>
                    <label class="stream-field">
                        <span>Left Controller Command Topic</span>
                        <input id="sim-left-command-topic" class="stream-input" value="${DEFAULT_SIM_STREAM_CONFIG.leftControllerCommandTopic}">
                    </label>
                    <label class="stream-field">
                        <span>Right Controller Command Topic</span>
                        <input id="sim-right-command-topic" class="stream-input" value="${DEFAULT_SIM_STREAM_CONFIG.rightControllerCommandTopic}">
                    </label>
                    <label class="stream-field">
                        <span>Sim Debug JointState Topic</span>
                        <input id="sim-debug-topic" class="stream-input" value="${DEFAULT_SIM_STREAM_CONFIG.simJointTopic}">
                    </label>
                </div>

                <div class="stream-section">
                    <label class="stream-field">
                        <span>Publish Rate</span>
                        <input id="sim-hz" class="stream-input" type="number" min="1" max="120" step="1" value="${DEFAULT_SIM_STREAM_CONFIG.simulationHz}">
                    </label>
                </div>

                <div class="stream-section">
                    <div class="stream-section-title">Joint Mapping</div>
                    <textarea id="sim-mapping-text" class="stream-textarea" spellcheck="false"></textarea>
                    <div class="stream-button-row">
                        <button id="sim-apply-mapping-btn" class="control-button">Apply Mapping</button>
                        <button id="sim-reset-mapping-btn" class="control-button">Reset Mapping</button>
                    </div>
                </div>

                <div class="stream-section">
                    <div class="stream-button-row">
                        <button id="sim-start-btn" class="control-button">Start Simulation</button>
                        <button id="sim-pause-btn" class="control-button">Pause</button>
                    </div>
                    <button id="sim-reset-pose-btn" class="control-button stream-full-button">Reset to URDF Initial Pose</button>
                </div>

                <div class="stream-section">
                    <div class="stream-section-title">Status</div>
                    <div class="stream-metrics">
                        <div><span>Connection</span><strong id="sim-connection-status">-</strong></div>
                        <div><span id="sim-last-age-label">Last Command Age</span><strong id="sim-last-age">-</strong></div>
                        <div><span id="sim-message-hz-label">Command Hz</span><strong id="sim-message-hz">0.0</strong></div>
                        <div><span>Mapped Joint Count</span><strong id="sim-mapped-count">0</strong></div>
                        <div><span>Missing Joint Count</span><strong id="sim-missing-count">0</strong></div>
                    </div>
                    <div id="sim-status-message" class="stream-status-line"></div>
                </div>
            </div>
        `;

        const mappingText = this.container.querySelector('#sim-mapping-text');
        if (mappingText) {
            mappingText.value = this.controller.getMappingText('sim');
        }
    }

    bindEvents() {
        this.container.querySelector('#sim-connect-btn')?.addEventListener('click', async () => {
            this.syncConfig();
            try {
                await this.controller.connect(this.getConfig().rosbridgeUrl);
            } catch (error) {
                this.setStatusMessage(error.message);
            }
            this.update();
        });

        this.container.querySelector('#sim-disconnect-btn')?.addEventListener('click', () => {
            this.controller.disconnect();
            this.update();
        });

        this.container.querySelector('#sim-start-btn')?.addEventListener('click', () => {
            this.syncConfig();
            this.controller.start('sim');
            this.update();
        });

        this.container.querySelector('#sim-pause-btn')?.addEventListener('click', () => {
            this.controller.pause();
            this.update();
        });

        this.container.querySelector('#sim-reset-pose-btn')?.addEventListener('click', () => {
            this.controller.resetToInitialPose();
            this.update();
        });

        this.container.querySelector('#sim-apply-mapping-btn')?.addEventListener('click', () => {
            const mappingText = this.container.querySelector('#sim-mapping-text')?.value || '';
            try {
                this.controller.setMappingFromText('sim', mappingText);
                this.setStatusMessage('Mapping applied');
            } catch (error) {
                this.setStatusMessage(`Mapping error: ${error.message}`);
            }
            this.update();
        });

        this.container.querySelector('#sim-reset-mapping-btn')?.addEventListener('click', () => {
            this.controller.resetMapping('sim');
            this.refreshMappingText();
            this.setStatusMessage('Mapping reset');
            this.update();
        });

        this.container.querySelector('#sim-backend-select')?.addEventListener('change', () => {
            this.syncConfig();
            this.refreshMappingText();
            this.update();
        });

        [
            'sim-ros-url',
            'sim-target-topic',
            'sim-publish-topic',
            'sim-current-topic',
            'sim-joint-states-topic',
            'sim-left-command-topic',
            'sim-right-command-topic',
            'sim-debug-topic',
            'sim-hz'
        ].forEach(id => {
            this.container.querySelector(`#${id}`)?.addEventListener('change', () => this.syncConfig());
        });
    }

    getConfig() {
        return {
            backend: this.container.querySelector('#sim-backend-select')?.value || DEFAULT_SIM_STREAM_CONFIG.backend,
            rosbridgeUrl: this.container.querySelector('#sim-ros-url')?.value || DEFAULT_SIM_STREAM_CONFIG.rosbridgeUrl,
            targetJointTopic: this.container.querySelector('#sim-target-topic')?.value || DEFAULT_SIM_STREAM_CONFIG.targetJointTopic,
            simJointTopic: this.container.querySelector('#sim-debug-topic')?.value
                || this.container.querySelector('#sim-publish-topic')?.value
                || DEFAULT_SIM_STREAM_CONFIG.simJointTopic,
            currentJointTopic: this.container.querySelector('#sim-current-topic')?.value || DEFAULT_SIM_STREAM_CONFIG.currentJointTopic,
            jointStatesTopic: this.container.querySelector('#sim-joint-states-topic')?.value || DEFAULT_SIM_STREAM_CONFIG.jointStatesTopic,
            leftControllerCommandTopic: this.container.querySelector('#sim-left-command-topic')?.value || DEFAULT_SIM_STREAM_CONFIG.leftControllerCommandTopic,
            rightControllerCommandTopic: this.container.querySelector('#sim-right-command-topic')?.value || DEFAULT_SIM_STREAM_CONFIG.rightControllerCommandTopic,
            simulationHz: this.container.querySelector('#sim-hz')?.value || DEFAULT_SIM_STREAM_CONFIG.simulationHz
        };
    }

    syncConfig() {
        this.controller.updateConfig('sim', this.getConfig());
    }

    refreshMappingText() {
        const mappingText = this.container.querySelector('#sim-mapping-text');
        if (mappingText) {
            mappingText.value = this.controller.getMappingText('sim');
        }
    }

    setStatusMessage(message) {
        const element = this.container.querySelector('#sim-status-message');
        if (element) {
            element.textContent = message || '';
        }
    }

    update() {
        if (!this.container) {
            return;
        }

        const status = this.controller.getStatus('sim');
        const config = status.config;
        const isFakeBackend = config.backend === SIM_BACKENDS.FAKE_FORWARD_POSITION_CONTROLLER;

        setValueIfIdle(this.container.querySelector('#sim-backend-select'), config.backend);
        setValueIfIdle(this.container.querySelector('#sim-ros-url'), config.rosbridgeUrl);
        setValueIfIdle(this.container.querySelector('#sim-target-topic'), config.targetJointTopic);
        setValueIfIdle(this.container.querySelector('#sim-publish-topic'), config.simJointTopic);
        setValueIfIdle(this.container.querySelector('#sim-current-topic'), config.currentJointTopic);
        setValueIfIdle(this.container.querySelector('#sim-joint-states-topic'), config.jointStatesTopic);
        setValueIfIdle(this.container.querySelector('#sim-left-command-topic'), config.leftControllerCommandTopic);
        setValueIfIdle(this.container.querySelector('#sim-right-command-topic'), config.rightControllerCommandTopic);
        setValueIfIdle(this.container.querySelector('#sim-debug-topic'), config.simJointTopic);
        setValueIfIdle(this.container.querySelector('#sim-hz'), config.simulationHz);

        setSectionVisible(this.container.querySelector('#sim-target-config-section'), !isFakeBackend);
        setSectionVisible(this.container.querySelector('#sim-fake-config-section'), isFakeBackend);

        const safetyLine = this.container.querySelector('#sim-safety-line');
        if (safetyLine) {
            safetyLine.innerHTML = isFakeBackend
                ? 'Arm Output: <strong>DISABLED</strong> · Fake Controller: <strong>ENABLED</strong> · Hardware CAN: <strong>DISABLED</strong>'
                : 'Arm Output: <strong>DISABLED</strong> · Hardware CAN: <strong>DISABLED</strong>';
        }

        const modelStatus = this.container.querySelector('#sim-model-status');
        if (modelStatus) {
            modelStatus.textContent = status.hasModel
                ? `${status.modelName} | movable joints: ${status.movableJointCount} | virtual joints: ${status.virtualJointCount}`
                : 'Load a URDF/model first';
        }

        const connectionStatus = this.container.querySelector('#sim-connection-status');
        if (connectionStatus) {
            connectionStatus.textContent = status.connection.status;
        }

        this.container.querySelector('#sim-last-age-label').textContent = isFakeBackend ? 'Last Command Age' : 'Last Message Age';
        this.container.querySelector('#sim-message-hz-label').textContent = isFakeBackend ? 'Command Hz' : 'Message Hz';
        this.container.querySelector('#sim-last-age').textContent = formatAge(status.lastMessageAgeMs);
        this.container.querySelector('#sim-message-hz').textContent = status.messageHz.toFixed(1);
        this.container.querySelector('#sim-mapped-count').textContent = String(status.mappedJointCount);
        this.container.querySelector('#sim-missing-count').textContent = String(status.missingJointCount);

        const startBtn = this.container.querySelector('#sim-start-btn');
        if (startBtn) {
            startBtn.classList.toggle('active', status.running);
        }

        const statusMessage = this.container.querySelector('#sim-status-message');
        if (statusMessage && status.statusMessage) {
            const missing = status.missingJoints.length > 0 ? ` | missing: ${status.missingJoints.join(', ')}` : '';
            statusMessage.textContent = `${status.statusMessage}${missing}`;
        }
    }
}

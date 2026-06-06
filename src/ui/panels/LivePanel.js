import { DEFAULT_LIVE_STREAM_CONFIG } from '../../stream/JointStateStreamController.js';

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

export class LivePanel {
    constructor(controller) {
        this.controller = controller;
        this.container = null;
        this.updateTimer = null;
    }

    init() {
        this.container = document.getElementById('live-panel-content');
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
                <div class="stream-safety">Arm Output: <strong>DISABLED</strong></div>

                <div class="stream-section">
                    <div class="stream-section-title">Current URDF / Model</div>
                    <div id="live-model-status" class="stream-status-line"></div>
                </div>

                <div class="stream-section">
                    <label class="stream-field">
                        <span>ROS Bridge WebSocket URL</span>
                        <input id="live-ros-url" class="stream-input" value="${DEFAULT_LIVE_STREAM_CONFIG.rosbridgeUrl}">
                    </label>
                    <div class="stream-button-row">
                        <button id="live-connect-btn" class="control-button">Connect</button>
                        <button id="live-disconnect-btn" class="control-button">Disconnect</button>
                    </div>
                </div>

                <div class="stream-section">
                    <label class="stream-field">
                        <span>Live JointState Topic</span>
                        <input id="live-topic" class="stream-input" value="${DEFAULT_LIVE_STREAM_CONFIG.liveJointTopic}">
                    </label>
                </div>

                <div class="stream-section">
                    <div class="stream-section-title">Joint Mapping</div>
                    <textarea id="live-mapping-text" class="stream-textarea" spellcheck="false"></textarea>
                    <div class="stream-button-row">
                        <button id="live-apply-mapping-btn" class="control-button">Apply Mapping</button>
                        <button id="live-reset-mapping-btn" class="control-button">Reset Mapping</button>
                    </div>
                </div>

                <div class="stream-section">
                    <div class="stream-button-row">
                        <button id="live-start-btn" class="control-button">Start Live View</button>
                        <button id="live-pause-btn" class="control-button">Pause</button>
                    </div>
                </div>

                <div class="stream-section">
                    <div class="stream-section-title">Status</div>
                    <div class="stream-metrics">
                        <div><span>Connection</span><strong id="live-connection-status">-</strong></div>
                        <div><span>Last Message Age</span><strong id="live-last-age">-</strong></div>
                        <div><span>Message Hz</span><strong id="live-message-hz">0.0</strong></div>
                        <div><span>Mapped Joint Count</span><strong id="live-mapped-count">0</strong></div>
                        <div><span>Missing Joint Count</span><strong id="live-missing-count">0</strong></div>
                    </div>
                    <div id="live-status-message" class="stream-status-line"></div>
                </div>
            </div>
        `;

        const mappingText = this.container.querySelector('#live-mapping-text');
        if (mappingText) {
            mappingText.value = this.controller.getMappingText('live');
        }
    }

    bindEvents() {
        this.container.querySelector('#live-connect-btn')?.addEventListener('click', async () => {
            this.syncConfig();
            try {
                await this.controller.connect(this.getConfig().rosbridgeUrl);
            } catch (error) {
                this.setStatusMessage(error.message);
            }
            this.update();
        });

        this.container.querySelector('#live-disconnect-btn')?.addEventListener('click', () => {
            this.controller.disconnect();
            this.update();
        });

        this.container.querySelector('#live-start-btn')?.addEventListener('click', () => {
            this.syncConfig();
            this.controller.start('live');
            this.update();
        });

        this.container.querySelector('#live-pause-btn')?.addEventListener('click', () => {
            this.controller.pause();
            this.update();
        });

        this.container.querySelector('#live-apply-mapping-btn')?.addEventListener('click', () => {
            const mappingText = this.container.querySelector('#live-mapping-text')?.value || '';
            try {
                this.controller.setMappingFromText('live', mappingText);
                this.setStatusMessage('Mapping applied');
            } catch (error) {
                this.setStatusMessage(`Mapping error: ${error.message}`);
            }
            this.update();
        });

        this.container.querySelector('#live-reset-mapping-btn')?.addEventListener('click', () => {
            this.controller.resetMapping('live');
            const mappingText = this.container.querySelector('#live-mapping-text');
            if (mappingText) {
                mappingText.value = this.controller.getMappingText('live');
            }
            this.setStatusMessage('Mapping reset');
            this.update();
        });

        ['live-ros-url', 'live-topic'].forEach(id => {
            this.container.querySelector(`#${id}`)?.addEventListener('change', () => this.syncConfig());
        });
    }

    getConfig() {
        return {
            rosbridgeUrl: this.container.querySelector('#live-ros-url')?.value || DEFAULT_LIVE_STREAM_CONFIG.rosbridgeUrl,
            liveJointTopic: this.container.querySelector('#live-topic')?.value || DEFAULT_LIVE_STREAM_CONFIG.liveJointTopic
        };
    }

    syncConfig() {
        this.controller.updateConfig('live', this.getConfig());
    }

    setStatusMessage(message) {
        const element = this.container.querySelector('#live-status-message');
        if (element) {
            element.textContent = message || '';
        }
    }

    update() {
        if (!this.container) {
            return;
        }

        const status = this.controller.getStatus('live');
        const config = status.config;

        setValueIfIdle(this.container.querySelector('#live-ros-url'), config.rosbridgeUrl);
        setValueIfIdle(this.container.querySelector('#live-topic'), config.liveJointTopic);

        const modelStatus = this.container.querySelector('#live-model-status');
        if (modelStatus) {
            modelStatus.textContent = status.hasModel
                ? `${status.modelName} | movable joints: ${status.movableJointCount}`
                : 'Load a URDF/model first';
        }

        const connectionStatus = this.container.querySelector('#live-connection-status');
        if (connectionStatus) {
            connectionStatus.textContent = status.connection.status;
        }

        this.container.querySelector('#live-last-age').textContent = formatAge(status.lastMessageAgeMs);
        this.container.querySelector('#live-message-hz').textContent = status.messageHz.toFixed(1);
        this.container.querySelector('#live-mapped-count').textContent = String(status.mappedJointCount);
        this.container.querySelector('#live-missing-count').textContent = String(status.missingJointCount);

        const startBtn = this.container.querySelector('#live-start-btn');
        if (startBtn) {
            startBtn.classList.toggle('active', status.running);
        }

        const statusMessage = this.container.querySelector('#live-status-message');
        if (statusMessage && status.statusMessage) {
            const missing = status.missingJoints.length > 0 ? ` | missing: ${status.missingJoints.join(', ')}` : '';
            statusMessage.textContent = `${status.statusMessage}${missing}`;
        }
    }
}

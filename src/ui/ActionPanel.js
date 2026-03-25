import { i18n } from '../utils/i18n.js';

function formatDuration(durationMs) {
    const totalMilliseconds = Math.max(0, Math.round(durationMs || 0));
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = totalMilliseconds % 1000;

    if (minutes > 0) {
        return `${minutes}:${seconds.toString().padStart(2, '0')}.${Math.floor(milliseconds / 10).toString().padStart(2, '0')}`;
    }

    return `${seconds}.${Math.floor(milliseconds / 10).toString().padStart(2, '0')}s`;
}

export class ActionPanel {
    constructor() {
        this.actions = [];
        this.selectedActionId = null;
        this.mappingSummary = null;
        this.playbackState = {
            isPlaying: false,
            playbackRate: 1,
            currentTimeMs: 0,
            durationMs: 0,
            hasModel: false
        };

        this.onImportRequested = null;
        this.onImportMappingRequested = null;
        this.onResetMappingRequested = null;
        this.onActionSelected = null;
        this.onPlayRequested = null;
        this.onPauseRequested = null;
        this.onStopRequested = null;
        this.onTimelineChanged = null;
        this.onPlaybackRateChanged = null;
    }

    init() {
        this.fileInput = document.getElementById('actions-file-input');
        this.importButton = document.getElementById('import-actions-btn');
        this.mappingFileInput = document.getElementById('mapping-file-input');
        this.importMappingButton = document.getElementById('import-mapping-btn');
        this.resetMappingButton = document.getElementById('reset-mapping-btn');
        this.mappingInfoElement = document.getElementById('action-mapping-info');
        this.listContainer = document.getElementById('actions-list');
        this.summaryElement = document.getElementById('action-summary');
        this.statusElement = document.getElementById('action-status');
        this.timeline = document.getElementById('action-timeline');
        this.currentTimeElement = document.getElementById('action-current-time');
        this.totalTimeElement = document.getElementById('action-total-time');
        this.playButton = document.getElementById('action-play-btn');
        this.pauseButton = document.getElementById('action-pause-btn');
        this.stopButton = document.getElementById('action-stop-btn');
        this.speedSelect = document.getElementById('action-speed-select');

        this.importButton?.addEventListener('click', () => {
            this.fileInput?.click();
        });

        this.fileInput?.addEventListener('change', async (event) => {
            const files = Array.from(event.target.files || []);
            if (files.length > 0) {
                await this.onImportRequested?.(files);
            }
            event.target.value = '';
        });

        this.importMappingButton?.addEventListener('click', () => {
            this.mappingFileInput?.click();
        });

        this.mappingFileInput?.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (file) {
                await this.onImportMappingRequested?.(file);
            }
            event.target.value = '';
        });

        this.resetMappingButton?.addEventListener('click', async () => {
            await this.onResetMappingRequested?.();
        });

        this.playButton?.addEventListener('click', () => {
            this.onPlayRequested?.();
        });

        this.pauseButton?.addEventListener('click', () => {
            this.onPauseRequested?.();
        });

        this.stopButton?.addEventListener('click', () => {
            this.onStopRequested?.();
        });

        this.speedSelect?.addEventListener('change', () => {
            this.onPlaybackRateChanged?.(this.speedSelect.value);
        });

        this.timeline?.addEventListener('input', () => {
            const progress = Number.parseFloat(this.timeline.value) / 1000;
            this.onTimelineChanged?.(progress);
        });

        this.renderMappingSummary();
        this.renderActionList();
        this.renderSummary();
        this.renderPlaybackState();
    }

    setActions(actions, selectedActionId = null) {
        this.actions = actions || [];
        this.selectedActionId = selectedActionId;
        this.renderActionList();
        this.renderSummary();
        this.renderPlaybackState();
    }

    setMappingSummary(mappingSummary) {
        this.mappingSummary = mappingSummary;
        this.renderMappingSummary();
    }

    updatePlaybackState(playbackState) {
        this.playbackState = {
            ...this.playbackState,
            ...playbackState
        };

        if (playbackState.selectedActionId !== undefined) {
            this.selectedActionId = playbackState.selectedActionId;
        }

        this.renderPlaybackState();
    }

    setStatus(status) {
        if (!this.statusElement || !status) {
            return;
        }

        this.statusElement.textContent = status.message || '';
        this.statusElement.className = `action-status ${status.type || 'info'}`;
    }

    refreshText() {
        this.renderMappingSummary();
        this.renderActionList();
        this.renderSummary();
        this.renderPlaybackState();
    }

    renderMappingSummary() {
        if (!this.mappingInfoElement) {
            return;
        }

        if (!this.mappingSummary) {
            this.mappingInfoElement.innerHTML = `<div class="empty-state">${i18n.t('mappingLoading')}</div>`;
            return;
        }

        const sourceLabelKey = `mappingSource${this.mappingSummary.source.charAt(0).toUpperCase()}${this.mappingSummary.source.slice(1)}`;
        const description = this.mappingSummary.description ? `<div class="action-mapping-description">${this.mappingSummary.description}</div>` : '';

        this.mappingInfoElement.innerHTML = `
            <div class="action-summary-row">${i18n.t('mappingName')}: ${this.mappingSummary.name}</div>
            <div class="action-summary-row">${i18n.t('mappingEntries')}: ${this.mappingSummary.entryCount}</div>
            <div class="action-summary-row">${i18n.t('mappingSource')}: ${i18n.t(sourceLabelKey)}</div>
            ${description}
        `;
    }

    renderActionList() {
        if (!this.listContainer) {
            return;
        }

        this.listContainer.innerHTML = '';

        if (this.actions.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.textContent = i18n.t('noActionsLoaded');
            this.listContainer.appendChild(emptyState);
            return;
        }

        this.actions.forEach(action => {
            const button = document.createElement('button');
            button.className = 'action-item';
            if (action.id === this.selectedActionId) {
                button.classList.add('active');
            }

            const title = document.createElement('div');
            title.className = 'action-item-title';
            title.textContent = action.name;

            const meta = document.createElement('div');
            meta.className = 'action-item-meta';
            meta.textContent = `${action.frameCount}f · ${formatDuration(action.durationMs)} · ${action.playableJointCount}/${action.jointCount}`;

            button.appendChild(title);
            button.appendChild(meta);

            if (action.unmappedRows > 0 || action.missingJointCount > 0) {
                const warning = document.createElement('div');
                warning.className = 'action-item-warning';
                const fragments = [];
                if (action.unmappedRows > 0) {
                    fragments.push(`${i18n.t('actionUnmapped')}: ${action.unmappedRows}`);
                }
                if (action.missingJointCount > 0) {
                    fragments.push(`${i18n.t('actionMissingModelJoints')}: ${action.missingJointCount}`);
                }
                warning.textContent = fragments.join(' · ');
                button.appendChild(warning);
            }

            button.addEventListener('click', () => {
                this.onActionSelected?.(action.id);
            });

            this.listContainer.appendChild(button);
        });
    }

    renderSummary() {
        if (!this.summaryElement) {
            return;
        }

        const selectedAction = this.actions.find(action => action.id === this.selectedActionId);
        if (!selectedAction) {
            this.summaryElement.innerHTML = `<div class="empty-state">${i18n.t('actionSelectPrompt')}</div>`;
            return;
        }

        const rows = [
            `${i18n.t('actionFrames')}: ${selectedAction.frameCount}`,
            `${i18n.t('actionDuration')}: ${formatDuration(selectedAction.durationMs)}`,
            `${i18n.t('actionJoints')}: ${selectedAction.jointCount}`,
            `${i18n.t('actionMapped')}: ${selectedAction.playableJointCount}/${selectedAction.jointCount}`
        ];

        if (selectedAction.unmappedRows > 0) {
            rows.push(`${i18n.t('actionUnmapped')}: ${selectedAction.unmappedRows}`);
        }
        if (selectedAction.missingJointCount > 0) {
            rows.push(`${i18n.t('actionMissingModelJoints')}: ${selectedAction.missingJointCount}`);
        }

        this.summaryElement.innerHTML = rows
            .map(row => `<div class="action-summary-row">${row}</div>`)
            .join('');
    }

    renderPlaybackState() {
        const {
            isPlaying,
            playbackRate,
            currentTimeMs,
            durationMs,
            hasModel
        } = this.playbackState;

        if (this.currentTimeElement) {
            this.currentTimeElement.textContent = formatDuration(currentTimeMs);
        }
        if (this.totalTimeElement) {
            this.totalTimeElement.textContent = formatDuration(durationMs);
        }
        if (this.timeline) {
            const progress = durationMs > 0 ? Math.round((currentTimeMs / durationMs) * 1000) : 0;
            this.timeline.value = progress;
            this.timeline.disabled = durationMs <= 0;
        }

        if (this.speedSelect) {
            this.speedSelect.value = String(playbackRate);
        }

        const hasSelectedAction = !!this.actions.find(action => action.id === this.selectedActionId);
        const canPlay = hasSelectedAction && hasModel;

        if (this.playButton) {
            this.playButton.disabled = !canPlay || isPlaying;
        }
        if (this.pauseButton) {
            this.pauseButton.disabled = !isPlaying;
        }
        if (this.stopButton) {
            this.stopButton.disabled = !hasSelectedAction;
        }
    }
}

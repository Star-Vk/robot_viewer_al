export const APP_MODES = {
    VIEWER: 'viewer',
    SIM: 'sim',
    LIVE: 'live'
};

const STREAM_MODES = new Set([APP_MODES.SIM, APP_MODES.LIVE]);

export class ModeManager {
    constructor() {
        this.currentMode = APP_MODES.VIEWER;
        this.onModeChanged = null;

        this.viewerPanelButtons = new Map([
            ['floating-files-panel', 'toggle-files-panel'],
            ['floating-joints-panel', 'toggle-joints-panel'],
            ['floating-actions-panel', 'toggle-actions-panel'],
            ['floating-model-tree', 'toggle-model-tree'],
            ['floating-help-panel', 'help-button'],
            ['code-editor-panel', 'open-editor-btn']
        ]);

        this.modePanels = {
            [APP_MODES.SIM]: {
                panelId: 'floating-sim-panel',
                buttonId: 'toggle-sim-panel'
            },
            [APP_MODES.LIVE]: {
                panelId: 'floating-live-panel',
                buttonId: 'toggle-live-panel'
            }
        };
    }

    init() {
        const modeSelect = document.getElementById('mode-select');
        if (modeSelect) {
            modeSelect.value = this.currentMode;
            modeSelect.addEventListener('change', () => {
                this.setMode(modeSelect.value);
            });
        }

        this.applyModeVisibility();
    }

    setMode(mode) {
        if (!Object.values(APP_MODES).includes(mode) || mode === this.currentMode) {
            return;
        }

        const previousMode = this.currentMode;
        this.currentMode = mode;

        const modeSelect = document.getElementById('mode-select');
        if (modeSelect && modeSelect.value !== mode) {
            modeSelect.value = mode;
        }

        this.applyModeVisibility();
        this.onModeChanged?.(mode, previousMode);
    }

    getMode() {
        return this.currentMode;
    }

    applyModeVisibility() {
        this.setToolbarVisibility('viewer-panel-toolbar', this.currentMode === APP_MODES.VIEWER);
        this.setToolbarVisibility('sim-panel-toolbar', this.currentMode === APP_MODES.SIM);
        this.setToolbarVisibility('live-panel-toolbar', this.currentMode === APP_MODES.LIVE);

        const helpButton = document.getElementById('help-button');
        if (helpButton) {
            helpButton.style.display = this.currentMode === APP_MODES.VIEWER ? '' : 'none';
        }

        if (this.currentMode === APP_MODES.VIEWER) {
            this.restoreViewerPanels();
            this.hideModePanel(APP_MODES.SIM);
            this.hideModePanel(APP_MODES.LIVE);
            this.restoreMujocoBar();
            return;
        }

        this.hideViewerPanels();
        this.hideMujocoBar();

        Object.keys(this.modePanels).forEach(mode => {
            if (mode === this.currentMode) {
                this.showModePanel(mode);
            } else {
                this.hideModePanel(mode);
            }
        });
    }

    setToolbarVisibility(id, visible) {
        const element = document.getElementById(id);
        if (element) {
            element.style.display = visible ? 'flex' : 'none';
        }
    }

    hideViewerPanels() {
        this.viewerPanelButtons.forEach((buttonId, panelId) => {
            const panel = document.getElementById(panelId);
            if (panel) {
                panel.style.display = 'none';
            }
        });
    }

    restoreViewerPanels() {
        this.viewerPanelButtons.forEach((buttonId, panelId) => {
            const panel = document.getElementById(panelId);
            const button = document.getElementById(buttonId);
            if (!panel) {
                return;
            }

            if (panelId === 'code-editor-panel') {
                panel.style.display = panel.classList.contains('visible') ? 'flex' : 'none';
                return;
            }

            const shouldShow = button?.classList.contains('active') || false;
            panel.style.display = shouldShow ? 'flex' : 'none';
        });
    }

    showModePanel(mode) {
        const config = this.modePanels[mode];
        if (!config) {
            return;
        }

        const panel = document.getElementById(config.panelId);
        const button = document.getElementById(config.buttonId);

        if (panel) {
            panel.style.display = 'flex';
        }
        if (button) {
            button.classList.add('active');
        }
    }

    hideModePanel(mode) {
        const config = this.modePanels[mode];
        if (!config) {
            return;
        }

        const panel = document.getElementById(config.panelId);
        const button = document.getElementById(config.buttonId);

        if (panel) {
            panel.style.display = 'none';
        }
        if (button && !STREAM_MODES.has(this.currentMode)) {
            button.classList.remove('active');
        }
    }

    hideMujocoBar() {
        const bar = document.getElementById('mujoco-simulation-bar');
        if (!bar) {
            return;
        }

        bar.dataset.modeHiddenDisplay = bar.style.display || '';
        bar.style.display = 'none';
    }

    restoreMujocoBar() {
        const bar = document.getElementById('mujoco-simulation-bar');
        if (!bar || bar.dataset.modeHiddenDisplay === undefined) {
            return;
        }

        bar.style.display = bar.dataset.modeHiddenDisplay;
        delete bar.dataset.modeHiddenDisplay;
    }
}

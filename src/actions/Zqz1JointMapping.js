const LOCAL_STORAGE_KEY = 'robotViewer.actionJointMapping';

export const DEFAULT_ACTION_JOINT_MAPPING_CONFIG = {
    name: 'default',
    version: 1,
    description: 'Default action-to-joint mapping used by the Actions panel.',
    mappings: {
        'can2:3': 'lw_shoulder_pitch',
        'can2:4': 'lw_arm_roll',
        'can2:5': 'lw_arm_yaw',
        'can2:6': 'lw_elbow_pitch',
        'can3:13': 'rw_shoulder_pitch',
        'can3:14': 'rw_arm_roll',
        'can3:15': 'rw_arm_yaw',
        'can3:16': 'rw_elbow_pitch',

        // Legacy action CSV aliases
        'can1:3': 'lw_shoulder_pitch',
        'can1:4': 'lw_arm_roll',
        'can1:5': 'lw_arm_yaw',
        'can1:6': 'lw_elbow_pitch',
        'can1:13': 'rw_shoulder_pitch',
        'can1:14': 'rw_arm_roll',
        'can1:15': 'rw_arm_yaw',
        'can1:16': 'rw_elbow_pitch'
    }
};

function cloneConfig(config) {
    return JSON.parse(JSON.stringify(config));
}

function normalizeMappings(rawMappings) {
    if (!rawMappings || typeof rawMappings !== 'object' || Array.isArray(rawMappings)) {
        return {};
    }

    const normalized = {};
    Object.entries(rawMappings).forEach(([key, value]) => {
        const trimmedKey = String(key).trim();
        const trimmedValue = typeof value === 'string' ? value.trim() : '';
        if (trimmedKey && trimmedValue) {
            normalized[trimmedKey] = trimmedValue;
        }
    });

    return normalized;
}

export function normalizeJointMappingConfig(rawConfig = {}, fallbackConfig = DEFAULT_ACTION_JOINT_MAPPING_CONFIG) {
    const fallback = cloneConfig(fallbackConfig);
    const fallbackMappings = normalizeMappings(fallback.mappings);

    const inferredMappings = rawConfig.mappings
        ? normalizeMappings(rawConfig.mappings)
        : normalizeMappings(rawConfig);

    return {
        name: typeof rawConfig.name === 'string' && rawConfig.name.trim()
            ? rawConfig.name.trim()
            : fallback.name,
        version: Number.isFinite(Number(rawConfig.version))
            ? Number(rawConfig.version)
            : fallback.version,
        description: typeof rawConfig.description === 'string'
            ? rawConfig.description
            : fallback.description,
        mappings: Object.keys(inferredMappings).length > 0 ? inferredMappings : fallbackMappings
    };
}

function getDefaultMappingUrl() {
    const baseUrl = import.meta.env.BASE_URL || './';
    return `${baseUrl}config/action-joint-mapping.json`;
}

export async function loadDefaultJointMappingConfigFromUrl(url = getDefaultMappingUrl()) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`Failed to load mapping config: ${response.status}`);
    }

    const json = await response.json();
    return normalizeJointMappingConfig(json);
}

export async function loadJointMappingConfigFromFile(file) {
    const rawText = await file.text();
    const json = JSON.parse(rawText);
    const config = normalizeJointMappingConfig(json);
    return {
        ...config,
        sourceFileName: file.name
    };
}

export function createActionJointMapping(initialConfig = DEFAULT_ACTION_JOINT_MAPPING_CONFIG) {
    let config = normalizeJointMappingConfig(initialConfig);

    return {
        resolveJointName(canIface, motorId) {
            return config.mappings[`${canIface}:${motorId}`] || null;
        },

        setConfig(nextConfig) {
            config = normalizeJointMappingConfig(nextConfig);
        },

        getConfig() {
            return cloneConfig(config);
        },

        getAllMappings() {
            return { ...config.mappings };
        }
    };
}

export function buildJointMappingSummary(config, source = 'default') {
    const normalizedConfig = normalizeJointMappingConfig(config);
    const entries = Object.entries(normalizedConfig.mappings)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

    return {
        name: normalizedConfig.name,
        version: normalizedConfig.version,
        description: normalizedConfig.description,
        source,
        entryCount: entries.length,
        entries
    };
}

export function saveJointMappingConfigToStorage(config) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalizeJointMappingConfig(config)));
}

export function loadJointMappingConfigFromStorage() {
    const rawValue = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!rawValue) {
        return null;
    }

    try {
        return normalizeJointMappingConfig(JSON.parse(rawValue));
    } catch (error) {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        return null;
    }
}

export function clearJointMappingConfigFromStorage() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
}

export const DEFAULT_ZQZ1_MAPPING_CONFIG = DEFAULT_ACTION_JOINT_MAPPING_CONFIG;
export const createZqz1JointMapping = createActionJointMapping;
export const loadJointMappingConfigFromUrl = loadDefaultJointMappingConfigFromUrl;

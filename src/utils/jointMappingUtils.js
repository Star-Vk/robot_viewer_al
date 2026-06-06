export const DEFAULT_JOINT_STATE_MAPPING_CONFIG = {
    name: 'openarm-stream-default',
    version: 1,
    source: 'joint_state',
    mappings: {}
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function finiteOrDefault(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeJointStateMappingConfig(rawConfig = {}) {
    const sourceConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const rawMappings = sourceConfig.mappings && typeof sourceConfig.mappings === 'object'
        ? sourceConfig.mappings
        : sourceConfig;

    const mappings = {};

    if (rawMappings && typeof rawMappings === 'object' && !Array.isArray(rawMappings)) {
        Object.entries(rawMappings).forEach(([sourceJointName, value]) => {
            const sourceName = String(sourceJointName || '').trim();
            if (!sourceName) {
                return;
            }

            if (typeof value === 'string') {
                const urdfJoint = value.trim();
                if (urdfJoint) {
                    mappings[sourceName] = urdfJoint;
                }
                return;
            }

            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const urdfJoint = String(value.urdf_joint || value.urdfJoint || '').trim();
                if (!urdfJoint) {
                    return;
                }

                mappings[sourceName] = {
                    urdf_joint: urdfJoint,
                    scale: finiteOrDefault(value.scale, 1.0),
                    offset: finiteOrDefault(value.offset, 0.0),
                    sign: finiteOrDefault(value.sign, 1.0) >= 0 ? 1 : -1
                };
            }
        });
    }

    return {
        name: typeof sourceConfig.name === 'string' && sourceConfig.name.trim()
            ? sourceConfig.name.trim()
            : DEFAULT_JOINT_STATE_MAPPING_CONFIG.name,
        version: Number.isFinite(Number(sourceConfig.version))
            ? Number(sourceConfig.version)
            : DEFAULT_JOINT_STATE_MAPPING_CONFIG.version,
        source: typeof sourceConfig.source === 'string' && sourceConfig.source.trim()
            ? sourceConfig.source.trim()
            : DEFAULT_JOINT_STATE_MAPPING_CONFIG.source,
        mappings
    };
}

export function parseJointStateMappingText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
        return normalizeJointStateMappingConfig(DEFAULT_JOINT_STATE_MAPPING_CONFIG);
    }

    return normalizeJointStateMappingConfig(JSON.parse(trimmed));
}

export function stringifyJointStateMappingConfig(config) {
    return JSON.stringify(normalizeJointStateMappingConfig(config), null, 2);
}

export function resolveJointStateMapping(config, sourceJointName, sourceValue) {
    const normalizedConfig = normalizeJointStateMappingConfig(config);
    const sourceName = String(sourceJointName || '').trim();
    const rawValue = Number(sourceValue);

    if (!sourceName || !Number.isFinite(rawValue)) {
        return null;
    }

    const mapping = normalizedConfig.mappings[sourceName];
    if (typeof mapping === 'string') {
        return {
            sourceJoint: sourceName,
            urdfJoint: mapping,
            value: rawValue
        };
    }

    if (mapping && typeof mapping === 'object') {
        const sign = finiteOrDefault(mapping.sign, 1.0) >= 0 ? 1 : -1;
        const scale = finiteOrDefault(mapping.scale, 1.0);
        const offset = finiteOrDefault(mapping.offset, 0.0);

        return {
            sourceJoint: sourceName,
            urdfJoint: mapping.urdf_joint,
            value: sign * rawValue * scale + offset
        };
    }

    return {
        sourceJoint: sourceName,
        urdfJoint: sourceName,
        value: rawValue
    };
}

export function cloneJointStateMappingConfig(config) {
    return clone(normalizeJointStateMappingConfig(config));
}

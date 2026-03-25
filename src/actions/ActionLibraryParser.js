function parseCsvText(csvText) {
    const lines = csvText
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        throw new Error('CSV file is empty');
    }

    const header = lines[0].split(',').map(item => item.trim());
    const expectedHeader = ['frame', 'can_iface', 'motor_id', 'position_rad', 'elapsed_ms'];
    const normalizedHeader = header.slice(0, expectedHeader.length);

    if (normalizedHeader.join(',') !== expectedHeader.join(',')) {
        throw new Error('Unsupported action CSV header');
    }

    const rows = [];
    for (let index = 1; index < lines.length; index += 1) {
        const parts = lines[index].split(',').map(item => item.trim());
        if (parts.length < 5) {
            continue;
        }

        rows.push({
            frameId: Number.parseInt(parts[0], 10),
            canIface: parts[1],
            motorId: Number.parseInt(parts[2], 10),
            positionRad: Number.parseFloat(parts[3]),
            elapsedMs: Number.parseInt(parts[4], 10),
            speedRadS: parts.length > 5 ? Number.parseFloat(parts[5]) : null,
            accelRadS2: parts.length > 6 ? Number.parseFloat(parts[6]) : null
        });
    }

    return rows.filter(row =>
        Number.isFinite(row.frameId) &&
        Number.isFinite(row.motorId) &&
        Number.isFinite(row.positionRad) &&
        Number.isFinite(row.elapsedMs)
    );
}

function buildParsedAction(csvText, fileName, jointMapping) {
    const rows = parseCsvText(csvText);

    if (rows.length === 0) {
        throw new Error('No valid action rows found');
    }

    const framesById = new Map();
    const jointNames = new Set();
    const unmappedRows = [];
    let mappedRows = 0;

    rows.forEach(row => {
        const jointName = jointMapping?.resolveJointName(row.canIface, row.motorId) || null;
        const key = `${row.canIface}:${row.motorId}`;
        const enrichedRow = { ...row, jointName, key };

        if (!framesById.has(row.frameId)) {
            framesById.set(row.frameId, {
                frameId: row.frameId,
                elapsedMs: row.elapsedMs,
                jointUpdates: {},
                rows: []
            });
        }

        const frame = framesById.get(row.frameId);
        frame.elapsedMs = Math.max(frame.elapsedMs, row.elapsedMs);
        frame.rows.push(enrichedRow);

        if (jointName) {
            frame.jointUpdates[jointName] = row.positionRad;
            jointNames.add(jointName);
            mappedRows += 1;
        } else {
            unmappedRows.push(enrichedRow);
        }
    });

    const sortedFrames = Array.from(framesById.values())
        .sort((a, b) => a.frameId - b.frameId);

    const runningPose = {};
    const resolvedFrames = sortedFrames.map(frame => {
        Object.entries(frame.jointUpdates).forEach(([jointName, value]) => {
            runningPose[jointName] = value;
        });

        return {
            frameId: frame.frameId,
            elapsedMs: frame.elapsedMs,
            jointUpdates: { ...frame.jointUpdates },
            jointPose: { ...runningPose }
        };
    });

    const actionName = fileName.replace(/\.csv$/i, '');

    return {
        id: actionName,
        name: actionName,
        fileName,
        sourceText: csvText,
        sourceSize: csvText.length,
        totalRows: rows.length,
        mappedRows,
        unmappedRows,
        jointNames: Array.from(jointNames),
        frames: resolvedFrames,
        frameCount: resolvedFrames.length,
        durationMs: resolvedFrames.length > 0
            ? resolvedFrames[resolvedFrames.length - 1].elapsedMs
            : 0
    };
}

export function parseActionCsvText(csvText, fileName, jointMapping) {
    return buildParsedAction(csvText, fileName, jointMapping);
}

export async function parseActionCsvFile(file, jointMapping) {
    const csvText = await file.text();
    const action = buildParsedAction(csvText, file.name, jointMapping);
    action.sourceSize = file.size;
    return action;
}

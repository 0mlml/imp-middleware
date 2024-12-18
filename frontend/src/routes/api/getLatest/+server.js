import {
    DATA_STATE_DEVICE_UNKNOWN,
    DATA_STATE_DEVICE_NOT_RESPONDING,
    DATA_STATE_LOADING,
    DATA_STATE_IN_MOUTH,
    DATA_STATE_OUT_MOUTH,
    TREND_WINDOW_SIZE,
    TEMP_THRESHOLD,
    HUMIDITY_THRESHOLD,
    MIN_INCREASING_SAMPLES,
    MIN_DECREASING_SAMPLES,
    DERIVATIVE_THRESHOLD,
    MINIMUM_TEMPERATURE_THRESHOLD,
    MINIMUM_HUMIDITY_THRESHOLD,
    MIN_STABLE_SAMPLES,
    ACCELERATION_DERIVATIVE_THRESHOLD,
    API_BASE,
} from '$lib/consts';

let environmentalTemperature = null;
let environmentalHumidity = null;

let previousState = false;
let isMotionStill = true;

export async function POST(event) {
    const request = event.request;
    const { updateEnvironment } = await request.json();

    if (updateEnvironment == true) {
        await getEnvironment(event);
    }
    const data = await (
        await fetch(`http://localhost:8080/getlatest?count=${TREND_WINDOW_SIZE}`)
    ).json();

    const { humidity, temperature } = data[0].humidity;
    const { x, y, z, peak_acceleration } = data[0].accelerometer;

    const tempHistory = data.map((d) => d.humidity.temperature);
    const humidityHistory = data.map((d) => d.humidity.humidity);

    const trends = analyzeTrends(tempHistory, humidityHistory);
    const thresholdsMet = checkThresholds(temperature, humidity, environmentalTemperature);

    isMotionStill = determineStillness(data);

    const current = {
        temperature: temperature,
        humidity: humidity,
        environmentalTemperature: environmentalTemperature,
        environmentalHumidity: environmentalHumidity,
    };

    const inMouth = determineState(trends, thresholdsMet, current);

    return new Response(
        JSON.stringify({
            success: true,
            body: {
                environmentalHumidity,
                environmentalTemperature,
                temperature,
                humidity,
                x,
                y,
                z,
                inMouth,
                trends,
                isMotionStill,
                peak_acceleration,
                thresholdsMet,
            },
        }),
        {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        },
    );
}

async function getEnvironment(event) {
    try {
        const response = await event.fetch('/api/getEnvironment');
        if (response.ok) {
            const environmentData = (await response.json()).body;
            environmentalTemperature = environmentData.environmentalTemperature;
            environmentalHumidity = environmentData.environmentalHumidity;
        }
    } catch (error) {
        console.error('Error updating environment data:', error);
    }
}

function analyzeTrends(tempHistory, humidityHistory) {
    let tempIncreasing = 0;
    let tempDecreasing = 0;
    let humidityIncreasing = 0;
    let humidityDecreasing = 0;

    for (let i = 1; i < tempHistory.length; i++) {
        // Temperature trend
        const tempDiff = tempHistory[i - 1] - tempHistory[i];
        if (tempDiff > DERIVATIVE_THRESHOLD) {
            tempIncreasing++;
            tempDecreasing = 0;
        } else if (tempDiff < -DERIVATIVE_THRESHOLD) {
            tempDecreasing++;
            tempIncreasing = 0;
        }

        // Humidity trend
        const humidityDiff = humidityHistory[i - 1] - humidityHistory[i];
        if (humidityDiff > DERIVATIVE_THRESHOLD) {
            humidityIncreasing++;
            humidityDecreasing = 0;
        } else if (humidityDiff < -DERIVATIVE_THRESHOLD) {
            humidityDecreasing++;
            humidityIncreasing = 0;
        }
    }

    return {
        increasing:
            tempIncreasing >= MIN_INCREASING_SAMPLES ||
            humidityIncreasing >= MIN_INCREASING_SAMPLES,
        decreasing:
            tempDecreasing >= MIN_DECREASING_SAMPLES ||
            humidityDecreasing >= MIN_DECREASING_SAMPLES,
        counts: {
            tempIncreasing,
            tempDecreasing,
            humidityIncreasing,
            humidityDecreasing,
        },
    };
}

function checkThresholds(temperature, humidity, envTemp) {
    const tempDiff = temperature - envTemp;
    return {
        tempMet: tempDiff >= TEMP_THRESHOLD,
        humidityMet: humidity >= HUMIDITY_THRESHOLD,
    };
}

function determineStillness(data) {
    let stableAccelPeriods = 0;

    for (let i = 1; i < data.length; i++) {
        const currentAccel = data[i].accelerometer.peak_acceleration;
        const prevAccel = data[i - 1].accelerometer.peak_acceleration;
        const accelDiff = Math.abs(currentAccel - prevAccel);

        if (accelDiff <= ACCELERATION_DERIVATIVE_THRESHOLD) {
            stableAccelPeriods++;
        } else {
            stableAccelPeriods = 0;
        }
    }

    return stableAccelPeriods >= MIN_STABLE_SAMPLES;
}

function determineState(trends, thresholdsMet, current) {
    if (
        current.temperature - MINIMUM_TEMPERATURE_THRESHOLD < current.environmentalTemperature ||
        current.humidity - MINIMUM_HUMIDITY_THRESHOLD < current.environmentalHumidity ||
        isMotionStill
    ) {
        previousState = false;
        return false;
    }

    // Clear decreasing trend - exit mouth state
    if (trends.decreasing) {
        previousState = false;
        return false;
    }

    // Clear increasing trend - enter mouth state
    if (trends.increasing) {
        previousState = true;
        return true;
    }

    // If thresholds are met, enter/maintain mouth state
    if (thresholdsMet.tempMet && thresholdsMet.humidityMet) {
        previousState = true;
        return true;
    }

    // If one threshold is not met, maintain previous state
    if ((thresholdsMet.tempMet || thresholdsMet.humidityMet) && previousState) {
        previousState = true;
        return true;
    }

    // Default to not in mouth
    previousState = false;
    return false;
}

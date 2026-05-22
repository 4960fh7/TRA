const width = 800;
const height = 800;

// Setup SVG container
const svg = d3.select("#map")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

// Create a main group wrapper inside SVG to handle Zoom manipulations properly
const mainGroup = svg.append("g");

// Setup Taiwan Map Projection
const projection = d3.geoMercator()
    .center([121, 23.6])
    .scale(9000)
    .translate([width / 2, height / 2]);

const path = d3.geoPath().projection(projection);
const tooltip = d3.select("#tooltip");
const mapUrl = "counties.json";

// Setup Zoom Behavior
const zoom = d3.zoom()
    .scaleExtent([1, 25]) // Limit scaling depth
    .on("zoom", (event) => {
        mainGroup.attr("transform", event.transform);
    });

svg.call(zoom);

// Generate Today's String Parameter (Format: YYYYMMDD)
function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

// Helper function to extract Coordinates safely
function getCoords(d) {
    let lat, lon;
    if (d.gps) {
        const parts = d.gps.toString().trim().split(/[\s,]+/);
        const nums = parts.map(Number).filter(n => !isNaN(n));
        lat = nums.find(n => n > 21 && n < 26);
        lon = nums.find(n => n > 119 && n < 123);
    } 
    else if (d['緯度'] && d['經度']) {
        lat = parseFloat(d['緯度']);
        lon = parseFloat(d['經度']);
    }
    return (lat && lon) ? { lat, lon } : null;
}

// Data loading configuration sequence
async function loadData() {
    try {
        const twData = await d3.json(mapUrl);
        let stationsData = [];

        try {
            stationsData = await d3.json("stations.json");
        } catch (e) {
            console.warn("Stations data file loading failed! Check repository references.");
        }
        
        drawMap(twData, stationsData);
    } catch (err) {
        console.error("Error configuration mapping pipeline:", err);
    }
}

function drawMap(twData, stationsData) {
    const objectsKey = Object.keys(twData.objects)[0];
    const counties = topojson.feature(twData, twData.objects[objectsKey]).features;

    // Draw counties inside our zoomable group wrapper
    mainGroup.selectAll(".county")
        .data(counties)
        .enter()
        .append("path")
        .attr("class", "county")
        .attr("d", path);

    // Draw station markers inside our zoomable group wrapper
    mainGroup.selectAll(".station")
        .data(stationsData)
        .enter()
        .append("circle")
        .attr("class", "station")
        .attr("r", 4)
        .attr("cx", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[0] : -9999;
        })
        .attr("cy", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[1] : -9999;
        })
        .on("mouseover", function(event, d) {
            d3.select(this).attr("r", 6);
            const name = d.stationName || d['車站中文名稱'] || d.name || "Unknown Station";
            
            tooltip.style("opacity", 1)
                   .html(name)
                   .style("left", (event.pageX + 10) + "px")
                   .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            d3.select(this).attr("r", 4);
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            event.stopPropagation();
            const stationCode = d.stationCode || d['車站代碼'] || d.id || "";
            const stationName = d.stationName || d['車站中文名稱'] || d.name || "Unknown Station";
            const stationAddrTw = d.stationAddrTw || d['站址'] || d.address || "N/A";

            showStationInfoPanel(stationCode, stationName, stationAddrTw);
        });
}

// Update DOM elements & Load daily operational timetables
async function showStationInfoPanel(code, name, address) {
    // Reveal sidebar layout shift
    document.getElementById("app-container").classList.add("split-mode");

    // Populate static fields
    const detailsContainer = document.getElementById("station-details");
    detailsContainer.innerHTML = `
        <h2>${name}</h2>
        <p><strong>Station Code:</strong> ${code}</p>
        <p><strong>Address:</strong> ${address}</p>
    `;

    const listContainer = document.getElementById("train-list-container");
    listContainer.innerHTML = `<p class="placeholder-text">Fetching live schedule tracking logs...</p>`;

    const dateStr = getTodayDateString();
    // Resolve Raw CDN pathway targeting user GitHub profile repository matching standard format layouts
    const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Diagram/main/data/${dateStr}.json`;

    try {
        const scheduleData = await d3.json(targetScheduleUrl);
        renderPassingTrains(scheduleData, code, listContainer);
    } catch (error) {
        console.error("CORS / Repository File Request Failure:", error);
        listContainer.innerHTML = `<p class="placeholder-text" style="color:#ef4444;">Could not load schedule dataset for date (${dateStr}). Verify path or configuration constraints.</p>`;
    }
}

// Scan daily schedules mapping matching entries passing target station nodes
function renderPassingTrains(trainsList, targetStationCode) {
    const listContainer = document.getElementById("train-list-container");
    
    if (!Array.isArray(trainsList)) {
        listContainer.innerHTML = `<p class="placeholder-text">Malformed calendar layout. Expecting high-level index collection lists.</p>`;
        return;
    }

    // Adapt logic based on target station properties stored inside variations of standard structures (e.g., StopTimes, stops)
    const activeMatches = trainsList.filter(train => {
        const stops = train.stopTimes || train.StopTimes || train.stops || [];
        return stops.some(stop => {
            const currentStopCode = stop.stationCode || stop.StationID || stop.stationId || stop.stationNo;
            return String(currentStopCode).trim() === String(targetStationCode).trim();
        });
    });

    if (activeMatches.length === 0) {
        listContainer.innerHTML = `<p class="placeholder-text">No active operations scheduled tracking matches through this station today.</p>`;
        return;
    }

    listContainer.innerHTML = ""; // Wipe active tracking templates

    activeMatches.forEach(train => {
        const card = document.createElement("div");
        card.className = "train-card";

        const trainTitle = train.train || train.TrainNo || "N/A";
        const trainNumber = train.number || train.TrainNo || "N/A";

        // Generate inner key-value metadata dynamically from info block properties
        let dynamicGridItems = "";
        if (train.info && typeof train.info === 'object') {
            Object.entries(train.info).forEach(([key, value]) => {
                const formattedValue = typeof value === 'object' ? JSON.stringify(value) : value;
                dynamicGridItems += `
                    <div class="info-item">
                        <span>${key}:</span> ${formattedValue}
                    </div>
                `;
            });
        } else {
            dynamicGridItems = `<div class="info-item"><span>Info Details:</span> ${train.info || 'N/A'}</div>`;
        }

        card.innerHTML = `
            <h4>Train No: ${trainNumber} (${trainTitle})</h4>
            <div class="train-info-grid">
                ${dynamicGridItems}
            </div>
        `;
        listContainer.appendChild(card);
    });
}

// Panel close handling registration event listeners
document.getElementById("close-panel-btn").addEventListener("click", () => {
    document.getElementById("app-container").classList.remove("split-mode");
});

// Run application
loadData();
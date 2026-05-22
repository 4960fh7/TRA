const width = 800;
const height = 800;

// Setup SVG container
const svg = d3.select("#map")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

// Main group wrapper to handle zoom transformations
const mainGroup = svg.append("g");

// Setup Taiwan Map Projection
const projection = d3.geoMercator()
    .center([121, 23.6])
    .scale(9000)
    .translate([width / 2, height / 2]);

const path = d3.geoPath().projection(projection);
const tooltip = d3.select("#tooltip");
const mapUrl = "counties.json";

// 1. Zoom behavior with dynamic circle scaling
const zoom = d3.zoom()
    .scaleExtent([1, 40]) // Increased scale extent for close-up viewing
    .on("zoom", (event) => {
        // Apply transform to the main map group
        mainGroup.attr("transform", event.transform);
        
        // Get current scale factor (1 means original size, 10 means 10x zoomed in)
        const k = event.transform.k;
        
        // Dynamically shrink the circles and their strokes as you zoom in
        mainGroup.selectAll(".station")
            .attr("r", Math.max(1, 4 / Math.sqrt(k))) 
            .style("stroke-width", `${0.5 / k}px`);
    });

svg.call(zoom);

// Generate Today's Date String (Format: YYYYMMDD)
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

// Data loading sequence
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

    // Draw counties
    mainGroup.selectAll(".county")
        .data(counties)
        .enter()
        .append("path")
        .attr("class", "county")
        .attr("d", path);

    // Draw station markers
    mainGroup.selectAll(".station")
        .data(stationsData)
        .enter()
        .append("circle")
        .attr("class", "station")
        .attr("r", 4) // Initial base radius
        .attr("cx", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[0] : -9999;
        })
        .attr("cy", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[1] : -9999;
        })
        .on("mouseover", function(event, d) {
            // Get current zoom transform scale so the hover effect scales accurately
            const currentTransform = d3.zoomTransform(svg.node());
            const baseRadius = 4 / Math.sqrt(currentTransform.k);
            d3.select(this).attr("r", baseRadius * 1.5);
            
            const name = d.stationName || d['車站中文名稱'] || d.name || "Unknown Station";
            
            tooltip.style("opacity", 1)
                   .html(name)
                   .style("left", (event.pageX + 10) + "px")
                   .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            const currentTransform = d3.zoomTransform(svg.node());
            d3.select(this).attr("r", Math.max(1, 4 / Math.sqrt(currentTransform.k)));
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
    document.getElementById("app-container").classList.add("split-mode");

    const detailsContainer = document.getElementById("station-details");
    detailsContainer.innerHTML = `
        <h2>${name}</h2>
        <p><strong>Station Code:</strong> ${code}</p>
        <p><strong>Address:</strong> ${address}</p>
    `;

    const listContainer = document.getElementById("train-list-container");
    listContainer.innerHTML = `<p class="placeholder-text">Fetching live schedule tracking logs...</p>`;

    const dateStr = getTodayDateString();
    
    // Using raw.githubusercontent.com for CORS compatibility
    const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Diagram/main/data/${dateStr}.json`;

    try {
        const scheduleData = await d3.json(targetScheduleUrl);
        renderPassingTrains(scheduleData, name, listContainer); // We pass station 'name' to filter matches
    } catch (error) {
        console.error("CORS / Repository File Request Failure:", error);
        listContainer.innerHTML = `<p class="placeholder-text" style="color:#ef4444;">Could not load schedule dataset for date (${dateStr}). Verify path constraints.</p>`;
    }
}

// 2. Scan train list and check if the station name matches an item in the "data" array
function renderPassingTrains(trainsList, targetStationName, listContainer) {
    if (!Array.isArray(trainsList)) {
        listContainer.innerHTML = `<p class="placeholder-text">Malformed JSON structure.</p>`;
        return;
    }

    // Filter trains where any stop 'x' inside the "data" array matches our station name
    const activeMatches = trainsList.filter(train => {
        const routeStops = train.data || [];
        return routeStops.some(stop => stop.x === targetStationName);
    });

    if (activeMatches.length === 0) {
        listContainer.innerHTML = `<p class="placeholder-text">No active operations scheduled through this station today.</p>`;
        return;
    }

    listContainer.innerHTML = ""; // Clear loader placeholder text

    activeMatches.forEach(train => {
        const card = document.createElement("div");
        card.className = "train-card";

        const trainType = train.train || "N/A";
        const trainNumber = train.number || "N/A";

        // Generate inner key-value metadata dynamically from the updated "info" block structure
        let dynamicGridItems = "";
        if (train.info && typeof train.info === 'object') {
            Object.entries(train.info).forEach(([key, value]) => {
                dynamicGridItems += `
                    <div class="info-item">
                        <span>${key}:</span> ${value}
                    </div>
                `;
            });
        } else {
            dynamicGridItems = `<div class="info-item"><span>Info:</span> ${train.info || 'N/A'}</div>`;
        }

        card.innerHTML = `
            <h4>${trainType} ${trainNumber}</h4>
            <div class="train-info-grid">
                ${dynamicGridItems}
            </div>
        `;
        listContainer.appendChild(card);
    });
}

// Panel close event handler
document.getElementById("close-panel-btn").addEventListener("click", () => {
    document.getElementById("app-container").classList.remove("split-mode");
});

// Run application
loadData();
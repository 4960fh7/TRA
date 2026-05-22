const width = 800;
const height = 800;

const svg = d3.select("#map")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

const mainGroup = svg.append("g");

const projection = d3.geoMercator()
    .center([121, 23.6])
    .scale(9000)
    .translate([width / 2, height / 2]);

const path = d3.geoPath().projection(projection);
const tooltip = d3.select("#tooltip");
const mapUrl = "counties.json";

let activeStationSelection = null;
let globalStationsData = []; // Cached stations dataset reference for search index match lookups

// Zoom behavior configuration
const zoom = d3.zoom()
    .scaleExtent([1, 40])
    .on("zoom", (event) => {
        mainGroup.attr("transform", event.transform);
        const k = event.transform.k;
        mainGroup.selectAll(".station")
            .attr("r", d => {
                // If it's active or connected, let it be slightly larger when zoomed in
                const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 5 : 4;
                return Math.max(1, base / Math.sqrt(k));
            })
            .style("stroke-width", `${0.5 / k}px`);
    });

svg.call(zoom);

function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function convertMinutesToHHMM(totalMinutes) {
    const absoluteMinutes = Math.floor(totalMinutes);
    const hours = Math.floor(absoluteMinutes / 60) % 24;
    const mins = absoluteMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

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

// Get the standardized name string of a station object
function getStationName(d) {
    return d.stationName || d['車站中文名稱'] || d.name || "";
}

async function loadData() {
    try {
        const twData = await d3.json(mapUrl);
        try {
            globalStationsData = await d3.json("stations.json");
        } catch (e) {
            console.warn("Stations data file loading failed!");
        }
        drawMap(twData, globalStationsData);
        initSearchAutocomplete();
    } catch (err) {
        console.error("Error configuring mapping pipeline:", err);
    }
}

function drawMap(twData, stationsData) {
    const objectsKey = Object.keys(twData.objects)[0];
    const counties = topojson.feature(twData, twData.objects[objectsKey]).features;

    mainGroup.selectAll(".county")
        .data(counties)
        .enter()
        .append("path")
        .attr("class", "county")
        .attr("d", path);

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
            const currentTransform = d3.zoomTransform(svg.node());
            const baseRadius = 4 / Math.sqrt(currentTransform.k);
            d3.select(this).attr("r", baseRadius * 1.5);
            
            const name = getStationName(d);
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
            selectStationElement(this, d);
        });
}

// Unified trigger to select a station (handles both clicks and search matching updates)
function selectStationElement(circleDOM, d) {
    // 1. Reset active class on the old selection using D3
    if (activeStationSelection) {
        d3.select(activeStationSelection).classed("active", false);
    }
    
    // 2. Clear all previous connected station highlights natively via D3
    mainGroup.selectAll(".station").classed("connected", false);

    // 3. Set new active selection
    d3.select(circleDOM).classed("active", true);
    activeStationSelection = circleDOM;

    const stationCode = d.stationCode || d['車站代碼'] || d.id || "";
    const stationName = getStationName(d);
    const stationAddrTw = d.stationAddrTw || d['站址'] || d.address || "N/A";

    showStationInfoPanel(stationCode, stationName, stationAddrTw);
    
    // Focus, center, and zoom map viewport on the selected coordinates
    const coords = getCoords(d);
    if (coords) {
        const projectedCoords = projection([coords.lon, coords.lat]);
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(12).translate(-projectedCoords[0], -projectedCoords[1]));
    }
}

async function showStationInfoPanel(code, name, address) {
    document.getElementById("app-container").classList.add("split-mode");

    document.getElementById("station-details").innerHTML = `
        <h2>${name}</h2>
        <p><strong>Station Code:</strong> ${code}</p>
        <p><strong>Address:</strong> ${address}</p>
    `;

    const ccwContainer = document.getElementById("train-list-ccw");
    const cwContainer = document.getElementById("train-list-cw");
    
    ccwContainer.innerHTML = `<p class="placeholder-text">Loading logs...</p>`;
    cwContainer.innerHTML = `<p class="placeholder-text">Loading logs...</p>`;

    const dateStr = getTodayDateString();
    const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Diagram/main/data/${dateStr}.json`;

    try {
        const scheduleData = await d3.json(targetScheduleUrl);
        renderSplitDirectionPassingTrains(scheduleData, name, ccwContainer, cwContainer);
    } catch (error) {
        console.error(error);
        ccwContainer.innerHTML = cwContainer.innerHTML = `<p class="placeholder-text" style="color:#ef4444;">Could not load logs.</p>`;
    }
}

// Processes matching routes, highlights map paths, and separates direction streams
function renderSplitDirectionPassingTrains(trainsList, targetStationName, ccwContainer, cwContainer) {
    if (!Array.isArray(trainsList)) {
        ccwContainer.innerHTML = cwContainer.innerHTML = `<p class="placeholder-text">Malformed structure.</p>`;
        return;
    }

    const connectedStationNames = new Set();
    const ccwTrains = []; // Counter-clockwise (Odd numbers)
    const cwTrains = [];  // Clockwise (Even numbers)

    trainsList.forEach(train => {
        const routeStops = train.data || [];
        const matchingStops = routeStops.filter(stop => stop.x === targetStationName);
        
        if (matchingStops.length > 0) {
            const depStop = matchingStops[matchingStops.length - 1];
            const departureMinutes = depStop.y;
            
            const trainData = {
                ...train,
                calculatedDepMinutes: departureMinutes,
                formattedTime: convertMinutesToHHMM(departureMinutes)
            };

            // Log all stations visited by this train to highlight connections
            routeStops.forEach(stop => {
                if (stop.x && stop.x !== targetStationName) {
                    connectedStationNames.add(stop.x);
                }
            });

            // Split streams dynamically by odd/even numerical properties
            const trainNumberInt = parseInt(train.number, 10);
            if (!isNaN(trainNumberInt)) {
                if (trainNumberInt % 2 === 0) {
                    cwTrains.push(trainData); // Even -> Clockwise (順行)
                } else {
                    ccwTrains.push(trainData); // Odd -> Counter-clockwise (逆行)
                }
            } else {
                ccwTrains.push(trainData); // Default fallback sorting
            }
        }
    });

    // Update map element aesthetics to blue for connected stops using D3's classed function
    mainGroup.selectAll(".station")
        .filter(function(d) {
            const name = getStationName(d);
            return connectedStationNames.has(name) && this !== activeStationSelection;
        })
        .classed("connected", true);

    // Sort both direction tracks independently by time priorities
    ccwTrains.sort((a, b) => a.calculatedDepMinutes - b.calculatedDepMinutes);
    cwTrains.sort((a, b) => a.calculatedDepMinutes - b.calculatedDepMinutes);

    // Render lists into their respective columns
    populateColumnContainer(ccwTrains, ccwContainer);
    populateColumnContainer(cwTrains, cwContainer);
}

// Injects custom formatted item card entries with click-to-toggle details behavior
function populateColumnContainer(trainsArray, containerElement) {
    containerElement.innerHTML = "";
    
    if (trainsArray.length === 0) {
        containerElement.innerHTML = `<p class="placeholder-text">No active schedules.</p>`;
        return;
    }

    trainsArray.forEach(train => {
        const card = document.createElement("div");
        card.className = "train-card";

        const trainType = train.train || "N/A";
        const trainNumber = train.number || "N/A";
        
        const infoObj = train.info || {};
        const viaLine = infoObj.via || "-";
        const rawEndStr = infoObj.end || "";
        
        const endStationTrimmed = rawEndStr.length > 6 ? rawEndStr.substring(6) : rawEndStr;
        const viaSegment = (viaLine !== "-") ? `經${viaLine}線 ` : "";
        const routeSubtitleText = `${viaSegment}往 ${endStationTrimmed}`;

        const startText = infoObj.start || "N/A";
        const endText = rawEndStr || "N/A";
        const noteText = infoObj.note || "無";

        card.innerHTML = `
            <div class="train-header">
                <strong>${train.formattedTime}</strong> ${trainType} ${trainNumber}
                <span class="train-sub-title">${routeSubtitleText}</span>
            </div>
            <div class="train-details">
                ${startText} → ${endText} 註：${noteText}
            </div>
        `;

        // Click to toggle info section collapse state
        card.querySelector(".train-header").addEventListener("click", () => {
            card.classList.toggle("expanded");
        });

        containerElement.appendChild(card);
    });
}

// Setup interactive autocomplete indexing logic loops
function initSearchAutocomplete() {
    const searchInput = document.getElementById("station-search-input");
    const suggestionsDropdown = document.getElementById("search-suggestions");

    searchInput.addEventListener("input", function() {
        const value = this.value.trim().toLowerCase();
        suggestionsDropdown.innerHTML = "";

        if (!value) {
            suggestionsDropdown.style.display = "none";
            return;
        }

        // Filter current stations array looking for partial string queries matching titles
        const matches = globalStationsData.filter(station => {
            const name = getStationName(station).toLowerCase();
            return name.includes(value);
        });

        if (matches.length === 0) {
            suggestionsDropdown.style.display = "none";
            return;
        }

        matches.forEach(station => {
            const name = getStationName(station);
            const item = document.createElement("div");
            item.className = "suggestion-item";
            item.textContent = name;
            
            item.addEventListener("click", () => {
                searchInput.value = name;
                suggestionsDropdown.style.display = "none";
                triggerSelectionByStationName(name);
            });
            suggestionsDropdown.appendChild(item);
        });

        suggestionsDropdown.style.display = "block";
    });

    // Select the station if the user presses enter inside the search input
    searchInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
            const val = this.value.trim();
            if (val) {
                triggerSelectionByStationName(val);
                suggestionsDropdown.style.display = "none";
            }
        }
    });

    // Close suggestions dropdown when clicking outside the input area
    document.addEventListener("click", (e) => {
        if (e.target !== searchInput) {
            suggestionsDropdown.style.display = "none";
        }
    });
}

// Finds the D3 circle element corresponding to a station name and triggers the selection sequence
function triggerSelectionByStationName(targetName) {
    const d3Circles = mainGroup.selectAll(".station");
    let matchedData = null;
    let matchedNode = null;

    d3Circles.each(function(d) {
        if (getStationName(d).toLowerCase() === targetName.toLowerCase()) {
            matchedData = d;
            matchedNode = this;
        }
    });

    if (matchedNode && matchedData) {
        selectStationElement(matchedNode, matchedData);
    } else {
        alert("Station not found. Please clarify spelling entries.");
    }
}

// Close Panel Button Actions
document.getElementById("close-panel-btn").addEventListener("click", () => {
    document.getElementById("app-container").classList.remove("split-mode");
    if (activeStationSelection) {
        d3.select(activeStationSelection).classed("active", false);
        activeStationSelection = null;
    }
    // Clear connection path highlights on layout close resets using D3
    mainGroup.selectAll(".station").classed("connected", false);
    
    // Zoom back out to show the full map overview
    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity);
});

loadData();
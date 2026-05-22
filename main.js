const width = 800;
const height = 800;

// Setup SVG container
const svg = d3.select("#map")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

// Setup Taiwan Map Projection (Mercator tailored for Taiwan)
const projection = d3.geoMercator()
    .center([121, 23.6])
    .scale(9000)
    .translate([width / 2, height / 2]);

const path = d3.geoPath().projection(projection);
const tooltip = d3.select("#tooltip");

// 1. Use the raw GitHub URL for CORS compatibility
const mapUrl = "counties.json";

// Helper function to extract Coordinates safely (Taiwan is usually ~Lat:21-26, Lon:119-122)
function getCoords(d) {
    let lat, lon;
    
    // Format 1: Single string like "25.0477 121.5170" inside "gps" field
    if (d.gps) {
        const parts = d.gps.toString().trim().split(/[\s,]+/);
        const nums = parts.map(Number).filter(n => !isNaN(n));
        lat = nums.find(n => n > 21 && n < 26);
        lon = nums.find(n => n > 119 && n < 123);
    } 
    // Format 2: CSV columns with dedicated Latitude/Longitude fields
    else if (d['緯度'] && d['經度']) {
        lat = parseFloat(d['緯度']);
        lon = parseFloat(d['經度']);
    }

    return (lat && lon) ? { lat, lon } : null;
}

// Data loading function
async function loadData() {
    try {
        const twData = await d3.json(mapUrl);
        let stationsData = [];

        // Attempt to load JSON first, fallback to CSV if the user downloaded that instead
        try {
            stationsData = await d3.json("stations.json");
        } catch (e) {
            console.warn("Stations data not found! Please ensure 'stations.json' is in your repository.");
        }
        
        drawMap(twData, stationsData);
    } catch (err) {
        console.error("Error drawing map:", err);
    }
}

function drawMap(twData, stationsData) {
    // Convert TopoJSON to GeoJSON
    const objectsKey = Object.keys(twData.objects)[0];
    const counties = topojson.feature(twData, twData.objects[objectsKey]).features;

    // Draw the counties
    svg.selectAll(".county")
        .data(counties)
        .enter()
        .append("path")
        .attr("class", "county")
        .attr("d", path);

    // Draw the stations (dots)
    svg.selectAll(".station")
        .data(stationsData)
        .enter()
        .append("circle")
        .attr("class", "station")
        .attr("r", 4)
        .attr("cx", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[0] : -9999; // hides invalid rows
        })
        .attr("cy", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[1] : -9999;
        })
        .on("mouseover", function(event, d) {
            // Increase radius on hover
            d3.select(this).attr("r", 6);
            
            // Extract the station name depending on JSON/CSV header formats
            const name = d.stationName || d['車站中文名稱'] || d.name || "Unknown Station";
            
            tooltip.style("opacity", 1)
                   .html(name)
                   .style("left", (event.pageX + 10) + "px")
                   .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            // Reset radius on mouseout
            d3.select(this).attr("r", 4);
            tooltip.style("opacity", 0);
        });
}

// Start sequence
loadData();
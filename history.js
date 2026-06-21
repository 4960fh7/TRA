let stationsMap = {};

async function init() {
    try {
        const res = await fetch('stations.json');
        const stations = await res.json();
        stations.forEach(s => {
            stationsMap[s.stationCode] = s.stationName;
        });
    } catch (e) {
        console.error("Failed to load stations.json", e);
    }
}

function parseTime(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
}

document.getElementById('fetch-btn').addEventListener('click', async () => {
    const dateStr = document.getElementById('date-input').value.trim();
    if (!dateStr || dateStr.length !== 4) {
        alert("請輸入正確的日期格式，例如 0601");
        return;
    }
    
    const wrapper = document.getElementById('charts-wrapper');
    wrapper.innerHTML = "<p style='color: #00f0ff;'>資料載入中，請稍候...</p>";
    
    try {
        const res = await fetch(`https://raw.githubusercontent.com/4960fh7/TDX_Fetch/main/merged_train_data_${dateStr}.json`);
        if (!res.ok) throw new Error("資料獲取失敗，請確認該日期有資料。");
        const data = await res.json();
        
        wrapper.innerHTML = "";
        
        if (!data || data.length === 0) {
            wrapper.innerHTML = "<p style='color: #ef4444;'>無此日期的資料</p>";
            return;
        }

        data.forEach(train => {
            if (!train.data || train.data.length === 0) return;
            
            const container = document.createElement('div');
            container.className = 'chart-container';
            
            const title = document.createElement('h2');
            title.className = 'chart-title';
            title.textContent = `車次: ${train.No}`;
            container.appendChild(title);
            
            const canvasWrapper = document.createElement('div');
            canvasWrapper.style.position = 'relative';
            canvasWrapper.style.height = 'calc(100% - 40px)';
            canvasWrapper.style.width = '100%';
            
            const canvas = document.createElement('canvas');
            canvasWrapper.appendChild(canvas);
            container.appendChild(canvasWrapper);
            wrapper.appendChild(container);
            
            let firstTime = parseTime(train.data[0].Update);
            
            const chartData = [];
            const xTicks = [];
            const timeToStation = {};
            
            train.data.forEach(d => {
                let sName = stationsMap[d.StationID] || d.StationID;
                let currentTime = parseTime(d.Update);
                
                // Handle cross midnight
                if (currentTime < firstTime - 12 * 3600) {
                    currentTime += 24 * 3600;
                }
                
                let timeSinceDep = (currentTime - firstTime) / 60; // in minutes
                
                chartData.push({ x: timeSinceDep, y: d.Delay });
                timeToStation[timeSinceDep] = sName;
                xTicks.push(timeSinceDep);
            });
            
            new Chart(canvas, {
                type: 'line',
                data: {
                    datasets: [{
                        label: '誤點時間 (分鐘)',
                        data: chartData,
                        borderColor: '#00f0ff',
                        backgroundColor: 'rgba(0, 240, 255, 0.2)',
                        borderWidth: 2,
                        tension: 0.1,
                        pointBackgroundColor: '#ff0055',
                        pointBorderColor: '#fff',
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: '停靠站',
                                color: '#d0ffe6',
                                font: {
                                    size: 14,
                                    family: "'Courier New', Courier, monospace"
                                }
                            },
                            grid: {
                                color: 'rgba(208, 255, 230, 0.1)'
                            },
                            afterBuildTicks: axis => {
                                axis.ticks = xTicks.map(v => ({ value: v }));
                            },
                            ticks: {
                                color: '#94a3b8',
                                maxRotation: 45,
                                minRotation: 45,
                                callback: function(value) {
                                    return timeToStation[value] || value;
                                }
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: '誤點時間 (分)',
                                color: '#d0ffe6',
                                font: {
                                    size: 14,
                                    family: "'Courier New', Courier, monospace"
                                }
                            },
                            grid: {
                                color: 'rgba(208, 255, 230, 0.1)'
                            },
                            ticks: {
                                color: '#94a3b8'
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: {
                                color: '#e2e8f0',
                                font: {
                                    family: "'Courier New', Courier, monospace"
                                }
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(13, 21, 38, 0.9)',
                            titleColor: '#00f0ff',
                            bodyColor: '#e2e8f0',
                            borderColor: '#1e293b',
                            borderWidth: 1,
                            callbacks: {
                                title: function(context) {
                                    let xVal = context[0].parsed.x;
                                    return '車站: ' + (timeToStation[xVal] || xVal);
                                }
                            }
                        }
                    }
                }
            });
        });
        
    } catch(e) {
        wrapper.innerHTML = `<p style='color: #ef4444;'>錯誤: ${e.message}</p>`;
    }
});

// Initialize
init();

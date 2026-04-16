document.addEventListener('DOMContentLoaded', () => {
    const zonesContainer = document.getElementById('zonesContainer');
    const addZoneBtn = document.getElementById('addZoneBtn');
    const optimizerForm = document.getElementById('optimizerForm');
    const runBtn = document.getElementById('runBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMsg = document.getElementById('errorMsg');
    const resultsSection = document.getElementById('resultsSection');

    let map;
    let markers = [];
    let lines = [];

    // Initialize Map
    function initMap() {
        if (map) return;
        map = L.map('map').setView([12.9716, 77.5946], 12);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(map);
    }

    // Initial Zones
    addZoneRow('Central-A', 5000, 0.8, 'open');
    addZoneRow('North-B', 12000, 0.9, 'partial');
    addZoneRow('South-C', 3000, 0.6, 'blocked');

    addZoneBtn.addEventListener('click', () => {
        const id = `Zone-${Math.floor(Math.random() * 1000)}`;
        addZoneRow(id, 1000, 0.5, 'open');
    });

    function addZoneRow(idStr = '', pop = 1000, sev = 0.5, status = 'open') {
        const row = document.createElement('div');
        row.className = 'zone-row animate-in';
        row.innerHTML = `
            <div class="input-group">
                <label>Zone ID</label>
                <input type="text" class="z-id" value="${idStr}" placeholder="e.g. Zone-1" required>
            </div>
            <div class="input-group">
                <label>Population</label>
                <input type="number" class="z-pop" value="${pop}" min="1" required>
            </div>
            <div class="input-group">
                <label>Severity (0-1.0)</label>
                <input type="number" class="z-sev" value="${sev}" min="0" max="1" step="0.1" required>
            </div>
            <div class="input-group">
                <label>Road Status</label>
                <select class="z-status">
                    <option value="open" ${status==='open'?'selected':''}>Open</option>
                    <option value="partial" ${status==='partial'?'selected':''}>Partial</option>
                    <option value="blocked" ${status==='blocked'?'selected':''}>Blocked</option>
                </select>
            </div>
            <button type="button" class="btn btn-remove remove-btn">×</button>
        `;
        zonesContainer.appendChild(row);

        row.querySelector('.remove-btn').addEventListener('click', () => {
            row.style.transform = 'translateX(20px)';
            row.style.opacity = '0';
            setTimeout(() => row.remove(), 300);
        });
    }

    optimizerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        errorMsg.classList.add('hidden');
        
        const supplies = {
            food: parseFloat(document.getElementById('foodSupply').value) || 0,
            water: parseFloat(document.getElementById('waterSupply').value) || 0,
            medicine: parseFloat(document.getElementById('medicineSupply').value) || 0,
        };

        const zoneRows = document.querySelectorAll('.zone-row');
        const zones = Array.from(zoneRows).map(row => ({
            zone_id: row.querySelector('.z-id').value,
            population: parseFloat(row.querySelector('.z-pop').value) || 0,
            severity_score: parseFloat(row.querySelector('.z-sev').value) || 0,
            road_status: row.querySelector('.z-status').value
        }));

        if (zones.length === 0) {
            showError("At least one zone is required.");
            return;
        }

        setLoading(true);
        try {
            const response = await fetch('https://disaster-supply-chain.onrender.com', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ supplies, zones })
            });

            if (!response.ok) throw new Error('Optimization engine failed.');

            const resData = await response.json();
            displayResults(resData.data);
            
        } catch (error) {
            showError(error.message);
        } finally {
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        runBtn.disabled = isLoading;
        loadingIndicator.classList.toggle('hidden', !isLoading);
        runBtn.textContent = isLoading ? "Calculating..." : "Generate Allocation Plan";
    }

    function showError(msg) {
        errorMsg.textContent = `⚠️ ${msg}`;
        errorMsg.classList.remove('hidden');
    }

    function displayResults(data) {
        resultsSection.classList.remove('hidden');
        initMap();

        // Stats & Metrics
        document.getElementById('coverageRate').textContent = `${Math.round(data.metrics.coverage_rate)}%`;
        document.getElementById('coverageFill').style.width = `${data.metrics.coverage_rate}%`;
        
        document.getElementById('wastageRate').textContent = `${Math.round(data.metrics.wastage_rate)}%`;
        document.getElementById('wastageFill').style.width = `${data.metrics.wastage_rate}%`;
        
        document.getElementById('responseMs').textContent = `${data.metrics.generation_time_ms}ms`;

        // AI Insights
        document.getElementById('aiShortages').textContent = data.ai_analysis.shortage_predictions;
        document.getElementById('aiRoutes').textContent = data.ai_analysis.route_recommendations;
        document.getElementById('aiBottlenecks').textContent = data.ai_analysis.bottleneck_detection;

        // Render Risk Flags
        const riskFlagsContainer = document.getElementById('riskFlagsContainer');
        riskFlagsContainer.innerHTML = '';
        if (data.shortage_risk_flags && data.shortage_risk_flags.length > 0) {
            data.shortage_risk_flags.forEach(flag => {
                const flagElement = document.createElement('div');
                const riskClass = flag.severity === 'critical' ? 'danger' : 'warning';
                flagElement.className = `risk-item`;
                flagElement.innerHTML = `
                    <div class="risk-badge ${riskClass}">${flag.severity.toUpperCase()}</div>
                    <div class="risk-details">
                        <strong>${flag.zone_id} • ${flag.item.toUpperCase()}</strong>
                        <p>${flag.message}</p>
                    </div>
                `;
                riskFlagsContainer.appendChild(flagElement);
            });
        } else {
            riskFlagsContainer.innerHTML = '<p class="success-text">No critical shortages predicted!</p>';
        }

        // Render Routes
        const routesContainer = document.getElementById('routesContainer');
        routesContainer.innerHTML = '';
        if (data.route_recommendations && data.route_recommendations.length > 0) {
            data.route_recommendations.forEach(route => {
                const routeElement = document.createElement('div');
                routeElement.className = 'route-item';
                routeElement.innerHTML = `
                    <div class="route-path">
                        <span class="route-node">Depot</span>
                        <div class="route-line-connect"></div>
                        <span class="route-node">${route.to}</span>
                    </div>
                    <div class="route-meta">
                        <span><strong>Dist:</strong> ${route.distance_km} km</span>
                        <span><strong>Time:</strong> ${route.estimated_time_h}h</span>
                        <span><strong>Veh:</strong> ${route.suggested_vehicle}</span>
                    </div>
                `;
                routesContainer.appendChild(routeElement);
            });
        } else {
            routesContainer.innerHTML = '<p class="placeholder-text">No routes required or computable.</p>';
        }

        // Table
        const tbody = document.querySelector('#allocationsTable tbody');
        tbody.innerHTML = '';
        
        // Clear Map
        markers.forEach(m => map.removeLayer(m));
        lines.forEach(l => map.removeLayer(l));
        markers = [];
        lines = [];

        const depotPos = [12.9716, 77.5946]; // Central Depot
        
        data.zones.forEach(z => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${z.zone_id}</strong></td>
                <td><span class="status-tag tag-${z.road_status}">${z.road_status}</span></td>
                <td>${Math.round(z.priority_score)}</td>
                <td>${Math.round(z.allocated.food)} / ${Math.round(z.computed_demand.food)}</td>
                <td>${Math.round(z.allocated.water)} / ${Math.round(z.computed_demand.water)}</td>
                <td>${Math.round(z.allocated.medicine)} / ${Math.round(z.computed_demand.medicine)}</td>
            `;
            tbody.appendChild(tr);

            // Add Marker
            const color = z.road_status === 'open' ? '#10b981' : z.road_status === 'partial' ? '#fbbf24' : '#f43f5e';
            const marker = L.circleMarker([z.coordinates.lat, z.coordinates.lng], {
                color: color,
                fillColor: color,
                fillOpacity: 0.8,
                radius: 8 + (z.population / 5000)
            }).addTo(map).bindPopup(`<b>${z.zone_id}</b><br>Population: ${z.population}<br>Status: ${z.road_status}`);
            markers.push(marker);

            // Add Route Line if not blocked
            if (z.road_status !== 'blocked') {
                const line = L.polyline([depotPos, [z.coordinates.lat, z.coordinates.lng]], {
                    color: color,
                    weight: 2,
                    opacity: 0.6,
                    dashArray: z.road_status === 'partial' ? '5, 10' : ''
                }).addTo(map);
                lines.push(line);
            }
        });

        // Fit map
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));

        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }
});

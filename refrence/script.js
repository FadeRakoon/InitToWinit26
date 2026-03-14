let map;
let gridFeatures = [];
let activeFeatureId = null;
let hoveredFeatureId = null;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize MapLibre Map
    map = new maplibregl.Map({
        container: 'map-background',
        // Carto Dark Matter style perfectly fits our UI out of the box
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [-74.0060, 40.7128], // NYC
        zoom: 12,
        attributionControl: true
    });

    // UI Elements
    const sidebar = document.getElementById('sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar');
    const emptyState = document.getElementById('empty-state');
    const loadingState = document.getElementById('loading-state');
    const dataState = document.getElementById('data-state');
    
    const regionIdEl = document.getElementById('region-id');
    const aiContentEl = document.getElementById('ai-content');
    const valActivityEl = document.getElementById('val-activity');
    const valAnomaliesEl = document.getElementById('val-anomalies');
    
    const searchInput = document.getElementById('search-input');
    const aiBtn = document.querySelector('.ai-btn');

    map.on('load', () => {
        createGridOverlays();
    });

    function createGridOverlays() {
        const centerLat = 40.7128;
        const centerLng = -74.0060;
        
        const rows = 20;
        const cols = 20;
        const latStep = 0.015;
        const lngStep = 0.02;
        
        const startLat = centerLat + ((rows/2) * latStep);
        const startLng = centerLng - ((cols/2) * lngStep);

        const columnLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

        // Generate GeoJSON grid
        const features = [];

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const north = startLat - (row * latStep);
                const south = startLat - ((row + 1) * latStep);
                const west = startLng + (col * lngStep);
                const east = startLng + ((col + 1) * lngStep);

                const cellId = `${columnLabels[col % 26]}${row + 1}`;
                const numericId = row * cols + col;

                features.push({
                    type: 'Feature',
                    id: numericId, // Critical for MapLibre feature-state
                    properties: { 
                        cellId: cellId,
                        centerLng: west + (lngStep / 2),
                        centerLat: south + (latStep / 2)
                    },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            [west, north],
                            [east, north],
                            [east, south],
                            [west, south],
                            [west, north]
                        ]]
                    }
                });
            }
        }

        gridFeatures = features;

        map.addSource('grid-source', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features
            }
        });

        // Fill layer for hover and active states
        map.addLayer({
            id: 'grid-fill',
            type: 'fill',
            source: 'grid-source',
            paint: {
                'fill-color': '#38bdf8',
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'active'], false],
                    0.4,
                    ['boolean', ['feature-state', 'hover'], false],
                    0.15,
                    0.0
                ]
            }
        });

        // Outline layer
        map.addLayer({
            id: 'grid-outline',
            type: 'line',
            source: 'grid-source',
            paint: {
                'line-color': '#38bdf8',
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'active'], false],
                    2,
                    1
                ],
                'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'active'], false],
                    1.0,
                    0.15
                ]
            }
        });

        // Hover events via MapLibre feature-state
        map.on('mousemove', 'grid-fill', (e) => {
            if (e.features.length > 0) {
                map.getCanvas().style.cursor = 'crosshair';
                
                if (hoveredFeatureId !== null) {
                    map.setFeatureState(
                        { source: 'grid-source', id: hoveredFeatureId },
                        { hover: false }
                    );
                }
                
                hoveredFeatureId = e.features[0].id;
                map.setFeatureState(
                    { source: 'grid-source', id: hoveredFeatureId },
                    { hover: true }
                );
            }
        });

        map.on('mouseleave', 'grid-fill', () => {
            map.getCanvas().style.cursor = '';
            if (hoveredFeatureId !== null) {
                map.setFeatureState(
                    { source: 'grid-source', id: hoveredFeatureId },
                    { hover: false }
                );
            }
            hoveredFeatureId = null;
        });

        // Click events
        map.on('click', 'grid-fill', (e) => {
            if (e.features.length > 0) {
                const feature = e.features[0];
                handleCellClick(feature.id, feature.properties.cellId);
            }
        });
    }

    function handleCellClick(numericId, cellId) {
        // Reset previous active cell
        if (activeFeatureId !== null) {
            map.setFeatureState(
                { source: 'grid-source', id: activeFeatureId },
                { active: false }
            );
        }
        
        // Highlight new active cell
        activeFeatureId = numericId;
        map.setFeatureState(
            { source: 'grid-source', id: activeFeatureId },
            { active: true }
        );

        // Open Sidebar
        sidebar.classList.remove('sidebar-hidden');
        
        // Show Loading State
        showState(loadingState);

        // Simulate AI Network Request
        setTimeout(() => {
            generateAIContent(cellId);
            showState(dataState);
        }, 1200 + Math.random() * 800);
    }

    function generateAIContent(regionId) {
        regionIdEl.textContent = `Region: ${regionId}`;
        
        const activities = ['Low', 'Moderate', 'High', 'Critical'];
        const currentActivity = activities[Math.floor(Math.random() * activities.length)];
        valActivityEl.textContent = currentActivity;
        
        if(currentActivity === 'High' || currentActivity === 'Critical') {
            valActivityEl.style.color = '#ef4444'; 
        } else if (currentActivity === 'Moderate') {
            valActivityEl.style.color = '#eab308'; 
        } else {
            valActivityEl.style.color = '#22c55e'; 
        }

        const anomalies = Math.floor(Math.random() * 5);
        valAnomaliesEl.textContent = `${anomalies} Detected`;

        const insights = [
            `Topographical analysis of <strong>${regionId}</strong> indicates stable structural integrity.`,
            `Recent thermal imaging in <strong>${regionId}</strong> shows a 12% increase in surface temperature variations over the last 48 hours.`,
            `No significant movement detected in vector patterns across <strong>${regionId}</strong>.`,
            `Historical AI models predict a high probability of resource concentration in the northern sector of <strong>${regionId}</strong>.`,
            `Anomalous communication signals detected bouncing off structural nodes in <strong>${regionId}</strong>.`,
            `Traffic flow in <strong>${regionId}</strong> deviates from standard predictive algorithms by 8.4%.`
        ];
        
        const selectedInsights = insights.sort(() => 0.5 - Math.random()).slice(0, 2);
        
        aiContentEl.innerHTML = '';
        
        const fullHTML = `<p>${selectedInsights[0]}</p><p>${selectedInsights[1]}</p><p>Recommendation: <em>${anomalies > 0 ? 'Dispatch drone for visual confirmation.' : 'Continue standard monitoring protocols.'}</em></p>`;
        
        aiContentEl.innerHTML = fullHTML;
        aiContentEl.classList.add('typing');
        
        setTimeout(() => {
            aiContentEl.classList.remove('typing');
        }, 2000);
    }

    function showState(stateElement) {
        emptyState.classList.remove('active');
        loadingState.classList.remove('active');
        dataState.classList.remove('active');
        stateElement.classList.add('active');
    }

    closeSidebarBtn.addEventListener('click', () => {
        sidebar.classList.add('sidebar-hidden');
        if (activeFeatureId !== null) {
            map.setFeatureState(
                { source: 'grid-source', id: activeFeatureId },
                { active: false }
            );
            activeFeatureId = null;
        }
        
        setTimeout(() => {
            showState(emptyState);
        }, 400);
    });

    // Simulated Search Interaction
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') triggerSearch(searchInput.value);
    });

    aiBtn.addEventListener('click', () => {
        if(searchInput.value) triggerSearch(searchInput.value);
    });

    function triggerSearch(query) {
        if (gridFeatures.length > 0) {
            // Pick a random region to act as our search result
            const randomFeature = gridFeatures[Math.floor(Math.random() * gridFeatures.length)];
            
            // Pan MapLibre map to the selected feature using flyTo
            map.flyTo({
                center: [randomFeature.properties.centerLng, randomFeature.properties.centerLat],
                zoom: 13,
                essential: true,
                duration: 2000
            });
            
            // Trigger click simulation
            handleCellClick(randomFeature.id, randomFeature.properties.cellId);
            
            searchInput.value = '';
            searchInput.placeholder = `Searched: ${query}...`;
        }
    }
});
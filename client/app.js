// ========================================
// CONFIGURATION
// ========================================
const API_URL = 'http://localhost:3000/api';

// Variable pour stocker la position de l'utilisateur
let userLocation = null;
let userMarker = null;

// ========================================
// INITIALISATION DE LA CARTE
// ========================================

const map = new ol.Map({
    target: 'map',
    layers: [
        new ol.layer.Tile({
            source: new ol.source.OSM(),
            title: 'OpenStreetMap'
        })
    ],
    view: new ol.View({
        center: ol.proj.fromLonLat([2.1682919, 41.3865289]), // Barcelona
        zoom: 13
    })
});

// ========================================
// COUCHES VECTORIELLES
// ========================================

// Source et couche pour les hôtels (rouge)
const hotelsSource = new ol.source.Vector();
const hotelsLayer = new ol.layer.Vector({
    source: hotelsSource,
    style: new ol.style.Style({
        image: new ol.style.Circle({
            radius: 8,
            fill: new ol.style.Fill({ color: '#dc3545' }),
            stroke: new ol.style.Stroke({ color: 'white', width: 2 })
        })
    }),
    title: 'Hôtels'
});
map.addLayer(hotelsLayer);

// Source et couche pour les restaurants (vert)
const restaurantsSource = new ol.source.Vector();
const restaurantsLayer = new ol.layer.Vector({
    source: restaurantsSource,
    style: new ol.style.Style({
        image: new ol.style.Circle({
            radius: 8,
            fill: new ol.style.Fill({ color: '#28a745' }),
            stroke: new ol.style.Stroke({ color: 'white', width: 2 })
        })
    }),
    title: 'Restaurants'
});
map.addLayer(restaurantsLayer);

// Source et couche pour la position de l'utilisateur (bleu)
const userSource = new ol.source.Vector();
const userLayer = new ol.layer.Vector({
    source: userSource,
    style: new ol.style.Style({
        image: new ol.style.Circle({
            radius: 10,
            fill: new ol.style.Fill({ color: '#007bff' }),
            stroke: new ol.style.Stroke({ color: 'white', width: 3 })
        })
    }),
    title: 'Votre Position'
});
map.addLayer(userLayer);

// ========================================
// POPUP
// ========================================

const popup = document.getElementById('popup');
const popupContent = document.getElementById('popup-content');
const popupCloser = document.getElementById('popup-closer');

const overlay = new ol.Overlay({
    element: popup,
    autoPan: true,
    autoPanAnimation: { duration: 250 }
});
map.addOverlay(overlay);

popupCloser.onclick = function() {
    overlay.setPosition(undefined);
    popupCloser.blur();
    return false;
};

// ========================================
// GÉOCODAGE
// ========================================

async function geocodeAddress(address) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`
        );
        const data = await response.json();
        
        if (data && data.length > 0) {
            return {
                longitude: parseFloat(data[0].lon),
                latitude: parseFloat(data[0].lat),
                displayName: data[0].display_name
            };
        }
        return null;
    } catch (error) {
        console.error('Erreur de géocodage:', error);
        return null;
    }
}

// ========================================
// RECHERCHE PAR ADRESSE
// ========================================

document.getElementById('searchLocation').addEventListener('click', async () => {
    const address = document.getElementById('userAddress').value.trim();
    
    if (!address) {
        showStatus('Veuillez entrer une adresse', 'error');
        return;
    }
    
    showLocationStatus('Recherche de l\'adresse...', 'searching');
    
    const location = await geocodeAddress(address);
    
    if (location) {
        setUserLocation(location.longitude, location.latitude, location.displayName);
        await loadNearbyEstablishments(location.longitude, location.latitude);
    } else {
        showStatus('Adresse non trouvée', 'error');
        hideLocationStatus();
    }
});

document.getElementById('userAddress').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('searchLocation').click();
    }
});

// ========================================
// GÉOLOCALISATION GPS
// ========================================

document.getElementById('useGPS').addEventListener('click', () => {
    if (!navigator.geolocation) {
        showStatus('La géolocalisation n\'est pas supportée', 'error');
        return;
    }
    
    showLocationStatus('Récupération de votre position GPS...', 'searching');
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lon = position.coords.longitude;
            const lat = position.coords.latitude;
            
            setUserLocation(lon, lat, 'Votre position GPS');
            await loadNearbyEstablishments(lon, lat);
        },
        (error) => {
            console.error('Erreur GPS:', error);
            showStatus('Impossible de récupérer votre position GPS', 'error');
            hideLocationStatus();
        }
    );
});

// ========================================
// DÉFINIR LA POSITION DE L'UTILISATEUR
// ========================================

function setUserLocation(longitude, latitude, label) {
    userLocation = { longitude, latitude };
    
    userSource.clear();
    
    const coordinate = ol.proj.fromLonLat([longitude, latitude]);
    
    userMarker = new ol.Feature({
        geometry: new ol.geom.Point(coordinate),
        name: label
    });
    
    userSource.addFeature(userMarker);
    
    map.getView().animate({
        center: coordinate,
        zoom: 13,
        duration: 1000
    });
    
    showLocationStatus(`📍 Position: ${label}`, 'active');
}

// ========================================
// CHARGER LES ÉTABLISSEMENTS À PROXIMITÉ
// ========================================

async function loadNearbyEstablishments(longitude, latitude) {
    const radius = document.getElementById('radius').value;
    const searchType = document.getElementById('searchType').value;
    
    try {
        console.log(`🔍 Recherche: Long=${longitude}, Lat=${latitude}, Rayon=${radius}m, Type=${searchType}`);
        
        const response = await fetch(
            `${API_URL}/nearby?longitude=${longitude}&latitude=${latitude}&radius=${radius}&type=${searchType}`
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ Erreur serveur:', errorData);
            throw new Error(errorData.details || 'Erreur lors du chargement');
        }

        const geojson = await response.json();
        
        console.log(`✅ Réponse reçue:`, geojson);
        
        // Effacer les anciennes features
        hotelsSource.clear();
        restaurantsSource.clear();
        
        // Séparer et ajouter les features selon le type
        const features = new ol.format.GeoJSON().readFeatures(geojson, {
            featureProjection: 'EPSG:3857'
        });
        
        let hotelsCount = 0;
        let restaurantsCount = 0;
        
        features.forEach(feature => {
            const type = feature.get('type');
            if (type === 'hotels') {
                hotelsSource.addFeature(feature);
                hotelsCount++;
            } else if (type === 'restaurants') {
                restaurantsSource.addFeature(feature);
                restaurantsCount++;
            }
        });
        
        const radiusKm = (radius / 1000).toFixed(1);
        
        let message = '';
        if (searchType === 'both') {
            message = `✅ ${hotelsCount} hôtel(s) et ${restaurantsCount} restaurant(s) dans ${radiusKm} km`;
        } else if (searchType === 'hotels') {
            message = `✅ ${hotelsCount} hôtel(s) dans ${radiusKm} km`;
        } else {
            message = `✅ ${restaurantsCount} restaurant(s) dans ${radiusKm} km`;
        }
        
        if (features.length === 0) {
            message = `⚠️ Aucun établissement trouvé dans ${radiusKm} km`;
        }
        
        showStatus(message, features.length > 0 ? 'success' : 'info');
        
        // Ajuster la vue
        if (features.length > 0) {
            const extent = ol.extent.createEmpty();
            
            if (hotelsCount > 0) {
                ol.extent.extend(extent, hotelsSource.getExtent());
            }
            if (restaurantsCount > 0) {
                ol.extent.extend(extent, restaurantsSource.getExtent());
            }
            if (userMarker) {
                ol.extent.extend(extent, userSource.getExtent());
            }
            
            map.getView().fit(extent, {
                padding: [100, 100, 100, 100],
                maxZoom: 15,
                duration: 1000
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur:', error);
        showStatus(`❌ Erreur: ${error.message}`, 'error');
    }
}

// ========================================
// CHANGEMENT DE RAYON OU TYPE
// ========================================

document.getElementById('radius').addEventListener('change', () => {
    if (userLocation) {
        loadNearbyEstablishments(userLocation.longitude, userLocation.latitude);
    }
});

document.getElementById('searchType').addEventListener('change', () => {
    if (userLocation) {
        loadNearbyEstablishments(userLocation.longitude, userLocation.latitude);
    }
});

// ========================================
// CHARGER TOUS LES ÉTABLISSEMENTS
// ========================================

async function loadAllEstablishments() {
    try {
        // Charger les hôtels
        const hotelsResponse = await fetch(`${API_URL}/hotels`);
        if (hotelsResponse.ok) {
            const hotelsData = await hotelsResponse.json();
            const hotelFeatures = new ol.format.GeoJSON().readFeatures(hotelsData, {
                featureProjection: 'EPSG:3857'
            });
            hotelsSource.clear();
            hotelsSource.addFeatures(hotelFeatures);
        }
        
        // Charger les restaurants
        const restaurantsResponse = await fetch(`${API_URL}/restaurants`);
        if (restaurantsResponse.ok) {
            const restaurantsData = await restaurantsResponse.json();
            const restaurantFeatures = new ol.format.GeoJSON().readFeatures(restaurantsData, {
                featureProjection: 'EPSG:3857'
            });
            restaurantsSource.clear();
            restaurantsSource.addFeatures(restaurantFeatures);
        }
        
        const total = hotelsSource.getFeatures().length + restaurantsSource.getFeatures().length;
        showStatus(`${total} établissement(s) chargé(s)`, 'success');
    } catch (error) {
        console.error('Erreur:', error);
        showStatus('Erreur lors du chargement', 'error');
    }
}

// ========================================
// MODE AJOUT
// ========================================

let addMode = false;
const toggleButton = document.getElementById('toggleAddMode');

toggleButton.addEventListener('click', () => {
    addMode = !addMode;
    if (addMode) {
        toggleButton.textContent = '❌ Désactiver l\'ajout';
        toggleButton.classList.add('active');
        showStatus('Mode ajout activé - Cliquez sur la carte', 'info');
    } else {
        toggleButton.textContent = '📍 Activer l\'ajout';
        toggleButton.classList.remove('active');
        showStatus('Mode ajout désactivé', 'info');
    }
});

// ========================================
// CLIC SUR LA CARTE
// ========================================

map.on('click', async (evt) => {
    if (addMode) {
        const coordinate = evt.coordinate;
        const lonLat = ol.proj.toLonLat(coordinate);
        
        const name = document.getElementById('establishmentName').value.trim();
        const type = document.getElementById('establishmentType').value;
        
        if (!name) {
            showStatus('Veuillez entrer un nom', 'error');
            return;
        }

        await addEstablishment(name, lonLat[0], lonLat[1], type);
        document.getElementById('establishmentName').value = '';
    } else {
        const feature = map.forEachFeatureAtPixel(evt.pixel, (feature) => feature);
        
        if (feature) {
            const props = feature.getProperties();
            const coordinate = evt.coordinate;
            
            const type = props.type === 'hotels' ? '🏨 Hôtel' : '🍽️ Restaurant';
            
            let content = `<h3>${type}: ${props.name || 'Sans nom'}</h3>`;
            
            if (props.longitude !== undefined) {
                content += `<p><strong>Longitude:</strong> ${props.longitude.toFixed(4)}</p>`;
                content += `<p><strong>Latitude:</strong> ${props.latitude.toFixed(4)}</p>`;
            }
            
            if (props.distance !== undefined) {
                const distanceKm = (props.distance / 1000).toFixed(2);
                content += `<p><strong>Distance:</strong> ${distanceKm} km</p>`;
            }
            
            if (props.name) {
                content += `<button onclick="deleteEstablishment('${props.type}', '${props.name}')" class="btn btn-secondary" style="margin-top: 10px;">🗑️ Supprimer</button>`;
            }
            
            popupContent.innerHTML = content;
            overlay.setPosition(coordinate);
        }
    }
});

// ========================================
// AJOUTER UN ÉTABLISSEMENT
// ========================================

async function addEstablishment(name, longitude, latitude, type) {
    try {
        const response = await fetch(`${API_URL}/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, longitude, latitude })
        });

        if (!response.ok) {
            throw new Error('Erreur lors de l\'ajout');
        }

        const typeLabel = type === 'hotels' ? 'Hôtel' : 'Restaurant';
        showStatus(`✅ ${typeLabel} "${name}" ajouté !`, 'success');
        
        if (userLocation) {
            await loadNearbyEstablishments(userLocation.longitude, userLocation.latitude);
        } else {
            await loadAllEstablishments();
        }
        
    } catch (error) {
        console.error('Erreur:', error);
        showStatus('❌ Erreur lors de l\'ajout', 'error');
    }
}

// ========================================
// SUPPRIMER UN ÉTABLISSEMENT
// ========================================

async function deleteEstablishment(type, name) {
    if (!confirm('Voulez-vous vraiment supprimer cet établissement ?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/${type}/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Erreur lors de la suppression');
        }

        overlay.setPosition(undefined);
        showStatus('Établissement supprimé', 'success');
        
        if (userLocation) {
            await loadNearbyEstablishments(userLocation.longitude, userLocation.latitude);
        } else {
            await loadAllEstablishments();
        }
        
    } catch (error) {
        console.error('Erreur:', error);
        showStatus('Erreur lors de la suppression', 'error');
    }
}

window.deleteEstablishment = deleteEstablishment;

// ========================================
// RAFRAÎCHIR
// ========================================

document.getElementById('refreshMap').addEventListener('click', () => {
    if (userLocation) {
        loadNearbyEstablishments(userLocation.longitude, userLocation.latitude);
    } else {
        loadAllEstablishments();
    }
    showStatus('Carte rafraîchie', 'info');
});

// ========================================
// UTILITAIRES
// ========================================

function showLocationStatus(message, className) {
    const statusDiv = document.getElementById('locationStatus');
    statusDiv.textContent = message;
    statusDiv.className = `location-status ${className}`;
}

function hideLocationStatus() {
    const statusDiv = document.getElementById('locationStatus');
    statusDiv.className = 'location-status';
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 3000);
}

// ========================================
// CHARGEMENT INITIAL
// ========================================

window.addEventListener('load', () => {
    loadAllEstablishments();
    showStatus('Application chargée !', 'success');
});
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// ========================================
// CONFIGURATION POSTGRESQL
// ========================================
// ⚠️ MODIFIEZ CES VALEURS SELON VOTRE CONFIGURATION
const pool = new Pool({
  user: 'postgres',           // Votre utilisateur PostgreSQL
  host: 'localhost',
  database: 'OpenLayersProject',   // Nom de votre base de données
  password: 'teborbi123!', // Votre mot de passe
  port: 5432,
});

// Middleware
app.use(cors());
app.use(bodyParser.json());

// ========================================
// TEST DE CONNEXION À LA BASE DE DONNÉES
// ========================================
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erreur de connexion à PostgreSQL:', err.stack);
  } else {
    console.log('✅ Connexion à PostgreSQL réussie !');
    release();
  }
});

// ========================================
// FONCTION GÉNÉRIQUE POUR RÉCUPÉRER DES ÉTABLISSEMENTS
// ========================================
async function getEstablishments(tableName) {
  const result = await pool.query(`
    SELECT 
      name, 
      longitude, 
      latitude,
      ST_AsGeoJSON(geom) as geojson
    FROM ${tableName}
    ORDER BY name
  `);
  
  return result.rows.map((row, index) => ({
    type: 'Feature',
    id: index + 1,
    geometry: JSON.parse(row.geojson),
    properties: {
      name: row.name,
      longitude: row.longitude,
      latitude: row.latitude,
      type: tableName // 'hotels' ou 'restaurants'
    }
  }));
}

// ========================================
// FONCTION GÉNÉRIQUE POUR RECHERCHE À PROXIMITÉ
// ========================================
async function getNearbyEstablishments(tableName, longitude, latitude, radius) {
  const result = await pool.query(`
    SELECT 
      name, 
      longitude, 
      latitude,
      ST_AsGeoJSON(geom) as geojson,
      ST_Distance(
        geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) as distance
    FROM ${tableName}
    WHERE ST_DWithin(
      geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    )
    ORDER BY distance
  `, [parseFloat(longitude), parseFloat(latitude), parseFloat(radius)]);
  
  return result.rows.map((row, index) => ({
    type: 'Feature',
    id: `${tableName}_${index + 1}`,
    geometry: JSON.parse(row.geojson),
    properties: {
      name: row.name,
      longitude: row.longitude,
      latitude: row.latitude,
      distance: Math.round(row.distance),
      type: tableName
    }
  }));
}

// ========================================
// ROUTE 1 : Récupérer tous les hôtels
// ========================================
app.get('/api/hotels', async (req, res) => {
  try {
    const features = await getEstablishments('hotels');
    res.json({ type: 'FeatureCollection', features });
    console.log(`✅ ${features.length} hôtels envoyés`);
  } catch (err) {
    console.error('❌ Erreur:', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ========================================
// ROUTE 2 : Récupérer tous les restaurants
// ========================================
app.get('/api/restaurants', async (req, res) => {
  try {
    const features = await getEstablishments('restaurants');
    res.json({ type: 'FeatureCollection', features });
    console.log(`✅ ${features.length} restaurants envoyés`);
  } catch (err) {
    console.error('❌ Erreur:', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ========================================
// ROUTE 3 : Recherche à proximité (HÔTELS ET/OU RESTAURANTS)
// ========================================
app.get('/api/nearby', async (req, res) => {
  const { longitude, latitude, radius, type } = req.query;

  console.log(`🔍 Recherche: Long=${longitude}, Lat=${latitude}, Rayon=${radius}m, Type=${type}`);

  if (!longitude || !latitude || !radius) {
    return res.status(400).json({ 
      error: 'Longitude, latitude et radius sont requis' 
    });
  }

  try {
    let allFeatures = [];

    // Type: 'hotels', 'restaurants', ou 'both'
    if (type === 'hotels' || type === 'both') {
      const hotelFeatures = await getNearbyEstablishments('hotels', longitude, latitude, radius);
      allFeatures = allFeatures.concat(hotelFeatures);
      console.log(`✅ ${hotelFeatures.length} hôtel(s) trouvé(s)`);
    }

    if (type === 'restaurants' || type === 'both') {
      const restaurantFeatures = await getNearbyEstablishments('restaurants', longitude, latitude, radius);
      allFeatures = allFeatures.concat(restaurantFeatures);
      console.log(`✅ ${restaurantFeatures.length} restaurant(s) trouvé(s)`);
    }

    // Trier par distance
    allFeatures.sort((a, b) => a.properties.distance - b.properties.distance);

    const geojson = {
      type: 'FeatureCollection',
      features: allFeatures,
      metadata: {
        count: allFeatures.length,
        searchCenter: { longitude, latitude },
        radiusMeters: radius,
        searchType: type
      }
    };

    console.log(`📊 Total: ${allFeatures.length} établissement(s)`);
    res.json(geojson);
  } catch (err) {
    console.error('❌ Erreur:', err);
    res.status(500).json({ 
      error: 'Erreur serveur', 
      details: err.message 
    });
  }
});

// ========================================
// ROUTE 4 : Ajouter un hôtel
// ========================================
app.post('/api/hotels', async (req, res) => {
  const { name, longitude, latitude } = req.body;

  if (!name || !longitude || !latitude) {
    return res.status(400).json({ 
      error: 'Nom, longitude et latitude sont requis' 
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO hotels (name, longitude, latitude, geom)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($2, $3), 4326))
      RETURNING name, longitude, latitude, ST_AsGeoJSON(geom) as geojson
    `, [name, longitude, latitude]);

    const newHotel = result.rows[0];
    console.log(`✅ Hôtel "${name}" ajouté`);
    
    res.status(201).json({
      type: 'Feature',
      id: 'new',
      geometry: JSON.parse(newHotel.geojson),
      properties: {
        name: newHotel.name,
        longitude: newHotel.longitude,
        latitude: newHotel.latitude,
        type: 'hotels'
      }
    });
  } catch (err) {
    console.error('❌ Erreur:', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ========================================
// ROUTE 5 : Ajouter un restaurant
// ========================================
app.post('/api/restaurants', async (req, res) => {
  const { name, longitude, latitude } = req.body;

  if (!name || !longitude || !latitude) {
    return res.status(400).json({ 
      error: 'Nom, longitude et latitude sont requis' 
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO restaurants (name, longitude, latitude, geom)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($2, $3), 4326))
      RETURNING name, longitude, latitude, ST_AsGeoJSON(geom) as geojson
    `, [name, longitude, latitude]);

    const newRestaurant = result.rows[0];
    console.log(`✅ Restaurant "${name}" ajouté`);
    
    res.status(201).json({
      type: 'Feature',
      id: 'new',
      geometry: JSON.parse(newRestaurant.geojson),
      properties: {
        name: newRestaurant.name,
        longitude: newRestaurant.longitude,
        latitude: newRestaurant.latitude,
        type: 'restaurants'
      }
    });
  } catch (err) {
    console.error('❌ Erreur:', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ========================================
// ROUTE 6 : Supprimer un établissement
// ========================================
app.delete('/api/:type/:name', async (req, res) => {
  const { type, name } = req.params;
  const tableName = type === 'hotels' ? 'hotels' : 'restaurants';

  try {
    const result = await pool.query(
      `DELETE FROM ${tableName} WHERE name = $1 RETURNING *`,
      [decodeURIComponent(name)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Établissement non trouvé' });
    }

    console.log(`✅ ${type} "${name}" supprimé`);
    res.json({ message: 'Supprimé avec succès', name: name });
  } catch (err) {
    console.error('❌ Erreur:', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ========================================
// ROUTE 7 : Statistiques
// ========================================
app.get('/api/stats', async (req, res) => {
  try {
    const hotels = await pool.query('SELECT COUNT(*) as count FROM hotels');
    const restaurants = await pool.query('SELECT COUNT(*) as count FROM restaurants');
    
    console.log(`📊 Stats: ${hotels.rows[0].count} hôtels, ${restaurants.rows[0].count} restaurants`);
    
    res.json({
      hotels: parseInt(hotels.rows[0].count),
      restaurants: parseInt(restaurants.rows[0].count),
      total: parseInt(hotels.rows[0].count) + parseInt(restaurants.rows[0].count)
    });
  } catch (err) {
    console.error('❌ Erreur:', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ========================================
// DÉMARRAGE DU SERVEUR
// ========================================
app.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(60));
  console.log('🚀 Serveur Hôtels & Restaurants démarré !');
  console.log('='.repeat(60));
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
  console.log(`🔍 Recherche: http://localhost:${PORT}/api/nearby?longitude=X&latitude=Y&radius=Z&type=both`);
  console.log('='.repeat(60));
  console.log('');
});
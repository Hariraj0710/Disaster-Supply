const mongoose = require('mongoose');

const coordinateSchema = new mongoose.Schema({
  lat: { type: Number },
  lng: { type: Number }
}, { _id: false });

const supplyQuantitySchema = new mongoose.Schema({
  food: { type: Number, default: 0 },
  water: { type: Number, default: 0 },
  medicine: { type: Number, default: 0 }
}, { _id: false });

const zoneSchema = new mongoose.Schema({
  zone_id: { type: String, required: true },
  population: { type: Number, required: true },
  severity_score: { type: Number, required: true },
  road_status: { type: String, enum: ['open', 'partial', 'blocked'], required: true },
  coordinates: coordinateSchema,
  computed_demand: supplyQuantitySchema,
  priority_score: { type: Number, required: true },
  allocated: supplyQuantitySchema,
  shortage: supplyQuantitySchema,
  shortage_risk: { type: String, enum: ['critical', 'high', 'moderate', 'low', 'none'], default: 'none' },
  served_within_48h: { type: Boolean, default: false }
}, { _id: false });

const routeSchema = new mongoose.Schema({
  from: { type: String, default: 'Central Depot' },
  to: { type: String, required: true },
  distance_km: { type: Number },
  estimated_time_h: { type: Number },
  road_condition: { type: String },
  priority: { type: String, enum: ['critical', 'high', 'medium', 'low'] },
  suggested_vehicle: { type: String }
}, { _id: false });

const optimizationResultSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  scenario_name: { type: String, default: 'Untitled Scenario' },
  depot_location: coordinateSchema,
  initial_supplies: supplyQuantitySchema,
  zones: [zoneSchema],
  total_shortages: supplyQuantitySchema,
  remaining_supplies: supplyQuantitySchema,
  route_recommendations: [routeSchema],
  metrics: {
    coverage_rate: { type: Number },        // % population served within 48h
    wastage_rate: { type: Number },         // % supplies sent to inaccessible zones
    bottleneck_count: { type: Number },     // number of bottleneck zones
    generation_time_ms: { type: Number },   // plan generation time
    zones_served: { type: Number },
    zones_total: { type: Number },
    total_population: { type: Number },
    served_population: { type: Number }
  },
  shortage_risk_flags: [{
    zone_id: String,
    item: String,
    severity: { type: String, enum: ['critical', 'high', 'moderate'] },
    deficit_percent: Number,
    message: String
  }],
  ai_analysis: {
    shortage_predictions: String,
    bottleneck_detection: String,
    explanation: String,
    route_recommendations: String,
    overall_risk_level: { type: String, enum: ['critical', 'high', 'moderate', 'low'], default: 'moderate' }
  }
});

optimizationResultSchema.index({ timestamp: -1 });

module.exports = mongoose.model('OptimizationResult', optimizationResultSchema);

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fetch = require('node-fetch');
const OptimizationResult = require('./models/OptimizationResult');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disaster_supply';

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const HF_API_KEY = process.env.HF_API_KEY;

const NEED_FACTORS = {
  food: 1.0,
  water: 1.2,
  medicine: 0.8
};

// Analysis Prompt helper
async function getAIAnalysis(allocationData) {
  if (!HF_API_KEY) {
    console.warn("No HF_API_KEY found, returning mock AI analysis.");
    return {
      shortage_predictions: "High likelihood of water shortages in Zone A.",
      bottleneck_detection: "Road access to Zone C is blocked, causing delays mapping supplies.",
      explanation: "Mock analysis due to missing API key."
    };
  }

  const prompt = `
You are an AI supply chain expert. Analyze the following disaster supply allocation data:
${JSON.stringify(allocationData, null, 2)}

Return your analysis strictly as a JSON object with this structure:
{
  "shortage_predictions": "...",
  "bottleneck_detection": "...",
  "explanation": "..."
}
Do not include any outside text. Only valid JSON.
`;

  try {
    const response = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2", {
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 300,
          temperature: 0.3,
          return_full_text: false
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`HF API error: ${response.statusText}`);
    }

    const result = await response.json();
    let textOut = result[0]?.generated_text || "";
    // Clean to extract json
    const startIdx = textOut.indexOf('{');
    const endIdx = textOut.lastIndexOf('}');
    if(startIdx !== -1 && endIdx !== -1) {
      return JSON.parse(textOut.slice(startIdx, endIdx + 1));
    }
    return { error: "Failed to parse JSON", raw: textOut };
  } catch (error) {
    console.error('AI Analysis Error:', error);
    return {
      shortage_predictions: "Could not be computed due to API error.",
      bottleneck_detection: "Could not be computed due to API error.",
      explanation: error.message
    };
  }
}

app.post('/api/optimize', async (req, res) => {
  try {
    const { zones, supplies } = req.body;
    
    if (!zones || !supplies) {
      return res.status(400).json({ error: 'Zones and supplies are required.' });
    }

    let remainingSupplies = { ...supplies };
    
const startTime = Date.now();

    // Process zones
    const processedZones = zones.map(zone => {
      const { population, severity_score, road_status, coordinates } = zone;
      
      const computed_demand = {
        food: population * severity_score * NEED_FACTORS.food,
        water: population * severity_score * NEED_FACTORS.water,
        medicine: population * severity_score * NEED_FACTORS.medicine
      };
      
      const priority_score = population * severity_score;

      // Assign random coordinates if missing (for synthetic map)
      const zoneCoords = coordinates || {
        lat: 12.9716 + (Math.random() - 0.5) * 0.1,
        lng: 77.5946 + (Math.random() - 0.5) * 0.1
      };
      
      return {
        ...zone,
        coordinates: zoneCoords,
        computed_demand,
        priority_score,
        allocated: { food: 0, water: 0, medicine: 0 }
      };
    });

    // Sort by priority_score descending
    processedZones.sort((a, b) => b.priority_score - a.priority_score);

    // Allocation Logic
    let totalAllocatedPop = 0;
    let totalTargetPop = zones.reduce((sum, z) => sum + z.population, 0);

    for (const zone of processedZones) {
      if (zone.road_status === 'blocked') continue; // Skip blocked zones entirely

      let allocationMultiplier = zone.road_status === 'partial' ? 0.5 : 1.0; 

      let zoneServed = false;
      for (const type of ['food', 'water', 'medicine']) {
        const demandAmt = zone.computed_demand[type] * allocationMultiplier;
        if (remainingSupplies[type] > 0) {
          const allocateAmt = Math.min(demandAmt, remainingSupplies[type]);
          zone.allocated[type] = allocateAmt;
          remainingSupplies[type] -= allocateAmt;
          if (allocateAmt > 0) zoneServed = true;
        }
      }
      if (zoneServed) {
        totalAllocatedPop += zone.population * allocationMultiplier;
      }
    }

    // Calculate Metrics
    const coverage_rate = (totalAllocatedPop / totalTargetPop) * 100;
    // Wastage rate: supplies tied up in partially accessible areas or remaining but unusable
    const totalSuppliesProvided = supplies.food + supplies.water + supplies.medicine;
    const totalAllocated = processedZones.reduce((sum, z) => 
      sum + z.allocated.food + z.allocated.water + z.allocated.medicine, 0);
    const wastage_rate = ((totalSuppliesProvided - totalAllocated) / totalSuppliesProvided) * 100;

    // Calculate Shortages and Risk Flags
    let total_shortages = { food: 0, water: 0, medicine: 0 };
    let shortage_risk_flags = [];
    let route_recommendations = [];

    processedZones.forEach(z => {
      // Shortages & Risks
      for (const item of ['food', 'water', 'medicine']) {
        const demand = z.computed_demand[item];
        const allocated = z.allocated[item];
        const shortage = Math.max(0, demand - allocated);
        
        if (z.road_status !== 'blocked') {
          total_shortages[item] += shortage;
        }

        if (demand > 0 && shortage > 0) {
          const deficit_percent = (shortage / demand) * 100;
          let severity = 'moderate';
          if (deficit_percent > 70 || z.road_status === 'blocked') severity = 'critical';
          else if (deficit_percent > 30) severity = 'high';

          if (severity === 'critical' || severity === 'high') {
             shortage_risk_flags.push({
               zone_id: z.zone_id,
               item: item,
               severity: severity,
               deficit_percent: deficit_percent,
               message: `${item.charAt(0).toUpperCase() + item.slice(1)} deficit at ${Math.round(deficit_percent)}%.`
             });
          }
        }
      }

      // Route Recommendations
      if (z.road_status !== 'blocked') {
        const dist = Math.floor(Math.random() * 50) + 10;
        route_recommendations.push({
          from: 'Central Depot',
          to: z.zone_id,
          distance_km: dist,
          estimated_time_h: Number((dist / (z.road_status === 'partial' ? 20 : 60)).toFixed(1)),
          road_condition: z.road_status,
          priority: z.priority_score > 5000 ? 'critical' : 'medium',
          suggested_vehicle: z.road_status === 'partial' ? 'Off-road 4x4 or Aerial' : 'Heavy Cargo Truck'
        });
      }
    });

    const generation_time_ms = Date.now() - startTime;

    const allocationDataForAI = {
      initial_supplies: supplies,
      zones: processedZones.map(z => ({
        id: z.zone_id,
        status: z.road_status,
        demand: z.computed_demand,
        allocated: z.allocated,
        shortage: {
          food: z.computed_demand.food - z.allocated.food,
          water: z.computed_demand.water - z.allocated.water,
          medicine: z.computed_demand.medicine - z.allocated.medicine
        }
      })),
      total_shortages,
      metrics: { coverage_rate, wastage_rate }
    };

    const ai_analysis_raw = await getAIAnalysis(allocationDataForAI);
    
    const ai_analysis = {
      shortage_predictions: ai_analysis_raw.shortage_predictions,
      bottleneck_detection: ai_analysis_raw.bottleneck_detection,
      explanation: ai_analysis_raw.explanation,
      route_recommendations: ai_analysis_raw.route_recommendations || "Prioritize routes through secondary highways for partial access zones."
    };

    // Save to Database
    const resultDoc = new OptimizationResult({
      initial_supplies: supplies,
      zones: processedZones,
      total_shortages,
      route_recommendations,
      shortage_risk_flags,
      metrics: {
        coverage_rate,
        wastage_rate,
        generation_time_ms
      },
      ai_analysis
    });

    await resultDoc.save();

    res.json({
      success: true,
      data: resultDoc
    });

  } catch (error) {
    console.error('Optimization Error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.get('/api/results', async (req, res) => {
  try {
    const results = await OptimizationResult.find().sort({ timestamp: -1 }).limit(10);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

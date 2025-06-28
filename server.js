const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const app = express();
const PORT = 3000;
const AIEngine = require('./ai-engine');
const ai = new AIEngine();



// Middleware
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use(express.static('public'));
app.use(express.json());
// Add these routes before app.listen()

// AI Recommendation Endpoint
app.post('/ai/recommend', async (req, res) => {
  try {
    const { bmi, bmiCategory, regenerate } = req.body;
    
    // Get appropriate meals from database
    const [meals] = await pool.query(`
      SELECT mp.* 
      FROM meal_plans mp
      JOIN bmi_categories bc ON mp.bmi_category_id = bc.id
      WHERE bc.category = ?
      ORDER BY RAND() ${regenerate ? 'LIMIT 8' : 'LIMIT 4'}
    `, [bmiCategory]);

    // Adjust calories based on BMI
    const adjustCalories = (baseCalories) => {
      if (bmi < 18.5) return Math.round(baseCalories * 1.2); // Increase for underweight
      if (bmi > 25) return Math.round(baseCalories * 0.8);   // Decrease for overweight
      return baseCalories;
    };

    // Organize by meal type
    const recommendations = {
      breakfast: meals.filter(m => m.meal_type === 'breakfast')
                     .map(m => `${m.food_items} (${adjustCalories(m.calories)} cal)`),
      lunch: meals.filter(m => m.meal_type === 'lunch')
                 .map(m => `${m.food_items} (${adjustCalories(m.calories)} cal)`),
      dinner: meals.filter(m => m.meal_type === 'dinner')
                  .map(m => `${m.food_items} (${adjustCalories(m.calories)} cal)`),
      snacks: meals.filter(m => m.meal_type === 'snack')
                  .map(m => `${m.food_items} (${adjustCalories(m.calories)} cal)`)
    };

    res.json(recommendations);

  } catch (err) {
    console.error('Recommendation error:', err);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

// Daily Tip Endpoint
app.get('/ai/daily-tip', (req, res) => {
  try {
    res.json({ tip: ai.getRandomTip() });
  } catch (err) {
    console.error('AI Tip Error:', err);
    res.status(500).send('Tip Service Error');
  }
});

// Save Weekly Plan
// Add to server.js
app.post('/api/save-weekly-plan', async (req, res) => {
  try {
    const { userId, planName, days } = req.body;
    
    // Insert into weekly_plans table
    const [result] = await pool.query(
      'INSERT INTO weekly_plans (user_id, plan_name) VALUES (?, ?)',
      [userId, planName]
    );
    
    const planId = result.insertId;
    
    // Insert each day's meals
    for (const day of days) {
      await pool.query(
        'INSERT INTO weekly_plan_days (weekly_plan_id, day_number, meal_data) VALUES (?, ?, ?)',
        [planId, day.dayNumber, JSON.stringify(day.meals)]
      );
    }
    
    res.json({ success: true, planId });
  } catch (err) {
    console.error('Save Weekly Plan Error:', err);
    res.status(500).json({ message: 'Failed to save weekly plan' });
  }
});

// Get user's health metrics
app.get('/api/health-metrics', async (req, res) => {
  try {
    const { userId } = req.query;
    const [metrics] = await pool.query(`
      SELECT 
        SUM(calories) as calories,
        SUM(protein) as protein,
        SUM(water) as water
      FROM daily_nutrition
      WHERE user_id = ? AND date = CURDATE()
    `, [userId]);

    res.json(metrics[0] || { calories: 0, protein: 0, water: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});
app.get('/api/weekly-plans/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const [plans] = await pool.query(
      `SELECT wp.id, wp.start_date, wp.end_date, 
       COUNT(wpd.id) as day_count 
       FROM weekly_plans wp
       LEFT JOIN weekly_plan_days wpd ON wp.id = wpd.weekly_plan_id
       WHERE wp.user_id = ?
       GROUP BY wp.id
       ORDER BY wp.start_date DESC`,
      [userId]
    );
    
    res.json(plans);
  } catch (err) {
    console.error('Get Weekly Plans Error:', err);
    res.status(500).json({ message: 'Failed to get weekly plans' });
  }
});

// Get Weekly Plan Details
app.get('/api/weekly-plan/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    
    const [plan] = await pool.query(
      `SELECT wp.* FROM weekly_plans wp WHERE wp.id = ?`,
      [planId]
    );
    
    if (plan.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }
    
    const [days] = await pool.query(
      `SELECT wpd.day_number, mp.diet_type, mp.food_items, mp.calories 
       FROM weekly_plan_days wpd
       JOIN meal_plans mp ON wpd.meal_plan_id = mp.id
       WHERE wpd.weekly_plan_id = ?
       ORDER BY wpd.day_number`,
      [planId]
    );
    
    res.json({
      ...plan[0],
      days
    });
  } catch (err) {
    console.error('Get Weekly Plan Error:', err);
    res.status(500).json({ message: 'Failed to get weekly plan' });
  }
});



app.post('/ai/feedback', (req, res) => {
  const { plan, feedback, userId } = req.body;
  ai.logFeedback(plan, feedback, userId);
  res.json({ success: true });
});

// Enhanced recommendation engine
app.get('/ai/meal-suggestions', async (req, res) => {
  const { bmi } = req.query;
  
  // Get BMI category
  const category = await getBMICategory(bmi);
  
  // Fetch meals from database
  const [meals] = await pool.query(`
    SELECT * FROM meal_plans 
    WHERE bmi_category = ?
    ORDER BY RAND() LIMIT 8
  `, [category]);
  
  // Organize by meal type
  const suggestions = {
    breakfast: meals.filter(m => m.meal_type === 'breakfast'),
    lunch: meals.filter(m => m.meal_type === 'lunch'),
    dinner: meals.filter(m => m.meal_type === 'dinner'),
    snacks: meals.filter(m => m.meal_type === 'snack')
  };
  
  res.json({ category, suggestions });
});

// Helper function
async function getBMICategory(bmi) {
  const [category] = await pool.query(`
    SELECT category FROM bmi_categories 
    WHERE ? BETWEEN min_value AND max_value
  `, [bmi]);
  
  return category[0]?.category || 'Normal';
}

// Save Favorite Plan
app.post('/api/save-favorite-plan', async (req, res) => {
  try {
    const { userId, planName, mealPlanId } = req.body;
    
    await pool.query(
      'INSERT INTO user_saved_plans (user_id, plan_name, meal_plan_id) VALUES (?, ?, ?)',
      [userId, planName, mealPlanId]
    );
    
    res.json({ success: true, message: 'Plan saved to favorites' });
  } catch (err) {
    console.error('Save Favorite Plan Error:', err);
    res.status(500).json({ message: 'Failed to save favorite plan' });
  }
});

// Get Favorite Plans
app.get('/api/favorite-plans/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const [plans] = await pool.query(
      `SELECT sp.id, sp.plan_name, mp.diet_type, mp.food_items, mp.calories 
       FROM user_saved_plans sp
       JOIN meal_plans mp ON sp.meal_plan_id = mp.id
       WHERE sp.user_id = ?
       ORDER BY sp.saved_at DESC`,
      [userId]
    );
    
    res.json(plans);
  } catch (err) {
    console.error('Get Favorite Plans Error:', err);
    res.status(500).json({ message: 'Failed to get favorite plans' });
  }
});




// MySQL Connection
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'Rajeswari@451',
  database: 'nutriplan',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});


// Initialize database with sample meal plans
async function initializeDatabase() {
  try {
    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bmi_categories (
        id INT PRIMARY KEY AUTO_INCREMENT,
        category VARCHAR(50),
        min_value FLOAT,
        max_value FLOAT
      )
    `);

    // In initializeDatabase() function:
await pool.query(`
  CREATE TABLE IF NOT EXISTS bmi_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    height_cm FLOAT,
    weight_kg FLOAT,
    bmi FLOAT,
    result VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS selected_plans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    plan_name VARCHAR(255),
    bmi FLOAT,
    bmi_category_id INT,
    selection_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bmi_category_id) REFERENCES bmi_categories(id)
  )
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS user_feedback (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    plan_name VARCHAR(255),
    feedback_type VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

    // Insert BMI categories
    const [existingCategories] = await pool.query('SELECT * FROM bmi_categories LIMIT 1');
    if (existingCategories.length === 0) {
      await pool.query(`
        INSERT INTO bmi_categories (category, min_value, max_value) VALUES
        ('Underweight', 0, 18.5),
        ('Normal', 18.5, 25),
        ('Overweight', 25, 30),
        ('Obese', 30, 100)
      `);
    }

    // Insert sample meal plans for each category
    const [existingMeals] = await pool.query('SELECT * FROM meal_plans LIMIT 1');
    if (existingMeals.length === 0) {
      // Get category IDs
      const [categories] = await pool.query('SELECT id, category FROM bmi_categories');
      
      // Sample meal plans for each diet type and BMI category
      const dietTypes = [
        'Keto Diet', 'Paleo Diet', 'Mediterranean Diet', 'Mental Wellness Diet',
        'Gluten-Free', 'Lactose-Free', 'Nut-Free', 'Vegetarian', 'Vegan',
        'Non-Vegetarian', 'Flexitarian', 'Pescatarian', 'Diabetic-Friendly',
        'Heart-Healthy', 'PCOS/Thyroid-Friendly', 'Renal Diet', 'Weight Loss',
        'Weight Gain', 'Muscle Building', 'Athletic Performance', 'Pre Workout',
        'Post Workout'
      ];

      for (const diet of dietTypes) {
    // Special plans only get one set of meals (using Normal weight category)
    if ([
      'Diabetic-Friendly', 'Heart-Healthy', 'PCOS/Thyroid-Friendly', 'Renal Diet',
      'Weight Loss', 'Weight Gain', 'Muscle Building', 'Athletic Performance',
      'Pre Workout', 'Post Workout'
    ].includes(diet)) {
      const meals = generateMealPlans(diet, 'Normal');
      for (const meal of meals) {
        await pool.query(
          'INSERT INTO meal_plans (diet_type, bmi_category_id, meal_type, food_items, calories) VALUES (?, ?, ?, ?, ?)',
          [diet, 2, meal.meal_type, meal.food_items, meal.calories]
        );
      }
    } else {
      // Regular plans get meals for all BMI categories
      for (const category of categories) {
        const meals = generateMealPlans(diet, category.category);
        for (const meal of meals) {
          await pool.query(
            'INSERT INTO meal_plans (diet_type, bmi_category_id, meal_type, food_items, calories) VALUES (?, ?, ?, ?, ?)',
            [diet, category.id, meal.meal_type, meal.food_items, meal.calories]
          );
        }
      }
    }
  }
}

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ 
    message: 'Something went wrong',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Generate sample meal plans based on diet and BMI category
function generateMealPlans(diet, bmiCategory) {
  const meals = [];
  const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
  
  // Base calorie adjustment based on BMI category
  let calorieFactor = 1;
  if (bmiCategory === 'Underweight') calorieFactor = 1.2;
  if (bmiCategory === 'Overweight') calorieFactor = 0.8;
  if (bmiCategory === 'Obese') calorieFactor = 0.7;

  for (const type of mealTypes) {
    let foodItems = '';
    let calories = 0;
    
    // Generate different meals based on diet type
    if (diet === 'Keto Diet') {
      foodItems = generateKetoMeal(type, bmiCategory);
      calories = Math.round(500 * calorieFactor);
    } else if (diet === 'Paleo Diet') {
      foodItems = generatePaleoMeal(type, bmiCategory);
      calories = Math.round(550 * calorieFactor);
    } else if (diet === 'Mediterranean Diet') {
      foodItems = generateMediterraneanMeal(type, bmiCategory);
      calories = Math.round(600 * calorieFactor);
    } else {
      // Default meal plan
      foodItems = `${type} items for ${diet} (${bmiCategory})`;
      calories = Math.round(500 * calorieFactor);
    }
    
    meals.push({
      meal_type: type,
      food_items: foodItems,
      calories: calories
    });
  }
  
  return meals;
}

// Sample meal generators (add more as needed)
function generateKetoMeal(mealType, bmiCategory) {
  const items = {
    breakfast: [
      'Scrambled eggs with avocado (350 cal)',
      'Bulletproof coffee (200 cal)'
    ],
    lunch: [
      'Grilled chicken with roasted vegetables (450 cal)',
      'Caesar salad with olive oil dressing (400 cal)'
    ],
    dinner: [
      'Salmon with asparagus and butter (500 cal)',
      'Beef steak with mushrooms (550 cal)'
    ],
    snack: [
      'Cheese slices with almonds (300 cal)',
      'Celery with peanut butter (250 cal)'
    ]
  };
  return items[mealType].join(', ');
}

function generatePaleoMeal(mealType, bmiCategory) {
  const items = {
    breakfast: [
      'Sweet potato hash with eggs (400 cal)',
      'Banana almond pancakes (450 cal)'
    ],
    lunch: [
      'Grilled salmon with sweet potato (500 cal)',
      'Chicken avocado salad (450 cal)'
    ],
    dinner: [
      'Beef stir-fry with vegetables (550 cal)',
      'Baked chicken with butternut squash (500 cal)'
    ],
    snack: [
      'Apple slices with almond butter (300 cal)',
      'Hard-boiled eggs (200 cal)'
    ]
  };
  return items[mealType].join(', ');
}

function generateMediterraneanMeal(mealType, bmiCategory) {
  const items = {
    breakfast: [
      'Greek yogurt with honey and nuts (350 cal)',
      'Whole grain toast with avocado (400 cal)'
    ],
    lunch: [
      'Grilled fish with quinoa salad (500 cal)',
      'Lentil soup with whole grain bread (450 cal)'
    ],
    dinner: [
      'Chicken with roasted vegetables (550 cal)',
      'Pasta with olive oil and vegetables (500 cal)'
    ],
    snack: [
      'Hummus with vegetables (300 cal)',
      'Mixed nuts (250 cal)'
    ]
  };
  return items[mealType].join(', ');
}

initializeDatabase();

// Routes
// Enhanced BMI endpoint
app.post('/calculate-bmi', async (req, res) => {
  let connection;
  try {
    const { weight, height, userId } = req.body;
    
    // Input validation
    if (!weight || !height || isNaN(weight) || isNaN(height)) {
      return res.status(400).json({ 
        error: 'Please enter valid weight and height numbers' 
      });
    }

    // Calculate BMI
    const bmi = (weight / Math.pow(height / 100, 2)).toFixed(1);

    // Get database connection
    connection = await pool.getConnection();

    // Get BMI category
    const [category] = await connection.query(
      `SELECT id, category FROM bmi_categories 
       WHERE ? BETWEEN min_value AND max_value`,
      [bmi]
    );

    if (!category || category.length === 0) {
      throw new Error('No matching BMI category found');
    } 

    // Save to history
    await connection.query(
      `INSERT INTO bmi_history 
       (user_id, height_cm, weight_kg, bmi, result,created_at) 
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [userId || null, height, weight, bmi, category[0].category]
    );

    return res.json({
      success: true,
      bmi,
      category: category[0].category,
      categoryId: category[0].id
    });

  } catch (err) {
    console.error('Database Error:', err);
    return res.status(500).json({ 
      error: 'Failed to process BMI calculation',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});
    
app.get('/meal-plan', async (req, res) => {
  try {
    const { bmi, dietType } = req.query;
    
    if (!bmi || !dietType) {
      return res.status(400).json({ message: 'BMI and diet type are required' });
    }

    // Determine if it's a special plan
    const specialPlans = [
      'Diabetic-Friendly', 'Heart-Healthy', 'PCOS/Thyroid-Friendly', 'Renal Diet',
      'Weight Loss', 'Weight Gain', 'Muscle Building', 'Athletic Performance', 'Pre Workout', 'Post Workout'
    ];

    let meals;
    let bmiCategory = { category: 'Standard' };

    if (specialPlans.includes(dietType)) {
      // Get BMI category for calorie adjustments
      const [bmiCategories] = await pool.query(
        'SELECT id, category FROM bmi_categories WHERE ? BETWEEN min_value AND max_value',
        [bmi]
      );
      
      if (bmiCategories.length > 0) {
        bmiCategory = bmiCategories[0];
      }

      // Get special meal plans with BMI-based calorie adjustments
      [meals] = await pool.query(
        `SELECT meal_type, food_items, calories 
         FROM special_meal_plans 
         WHERE diet_type = ? AND (bmi_category_id = ? OR bmi_category_id IS NULL)
         ORDER BY FIELD(meal_type, 'breakfast', 'snack', 'lunch', 'dinner')`,
        [dietType, bmiCategory.id]
      );
    } else {
      // Regular meal plan logic remains the same
      const [bmiCategories] = await pool.query(
        'SELECT id, category FROM bmi_categories WHERE ? BETWEEN min_value AND max_value',
        [bmi]
      );

      if (bmiCategories.length === 0) {
        return res.status(400).json({ message: 'Invalid BMI value' });
      }

      bmiCategory = bmiCategories[0];
    
      [meals] = await pool.query(
        `SELECT meal_type, food_items, calories FROM meal_plans
         WHERE diet_type = ? AND bmi_category_id = ?
         ORDER BY FIELD(meal_type, 'breakfast', 'snack', 'lunch', 'dinner')`,
        [dietType, bmiCategory.id]
      );
    }
    
    if (meals.length === 0) {
      return res.status(404).json({ 
        message: 'No meal plan found for this combination' 
      });
    }

    // Calculate total calories
    const totalCalories = meals.reduce((sum, meal) => sum + meal.calories, 0);

    res.json({
      dietType,
      bmiCategory: bmiCategory.category,
      meals,
      totalCalories
    });

  } catch (err) {
    console.error('Meal Plan Error:', err);
    res.status(500).json({ message: 'Failed to fetch meal plan' });
  }
});



// Enhanced BMI calculation endpoint
app.post('/calculate-bmi', async (req, res) => {
  try {
    const { weight, height, userId } = req.body;
    
    if (!weight || !height) {
      return res.status(400).json({ message: 'Weight and height are required' });
    }

    const heightInMeters = height / 100;
    const bmi = (weight / (heightInMeters * heightInMeters)).toFixed(1);
    
    // Get BMI category
    const [category] = await pool.query(
      'SELECT id, category FROM bmi_categories WHERE ? BETWEEN min_value AND max_value',
      [bmi]
    );

    if (!category || category.length === 0) {
      return res.status(400).json({ message: 'Invalid BMI calculation' });
    }

    // Save to bmi_history
    await pool.query(
      'INSERT INTO bmi_history (user_id, height_cm, weight_kg, bmi, result) VALUES (?, ?, ?, ?, ?)',
      [userId || null, height, weight, bmi, category[0].category]
    );

    res.json({ 
      bmi, 
      category: category[0].category,
      categoryId: category[0].id
    });
  } catch (err) {
    console.error('BMI Calculation Error:', err);
    res.status(500).json({ message: 'BMI calculation failed' });
  }
});

//enhanced meal plan endpoint
// In the /meal-plan endpoint, modify it like this:
app.get('/meal-plan', async (req, res) => {
  try {
    const { bmi, dietType } = req.query;
    
    if (!bmi || !dietType) {
      return res.status(400).json({ message: 'BMI and diet type are required' });
    }

    // List of special plans that don't need BMI categories
    const specialPlans = [
      'Diabetic-Friendly', 'Heart-Healthy', 'PCOS/Thyroid-Friendly', 'Renal Diet',
      'Weight Loss', 'Weight Gain', 'Muscle Building', 'Athletic Performance',
      'Pre Workout', 'Post Workout'
    ];

    let meals;
    
    if (specialPlans.includes(dietType)) {
      // For special plans, just get the first category (we'll use Normal weight as default)
      [meals] = await pool.query(
        `SELECT meal_type, food_items, calories FROM meal_plans
         WHERE diet_type = ? AND bmi_category_id = 2
         ORDER BY FIELD(meal_type, 'breakfast', 'snack', 'lunch', 'dinner')`,
        [dietType]
      );
    } else {
      // For regular plans, use BMI category
      const [bmiCategories] = await pool.query(
        'SELECT id, category FROM bmi_categories WHERE ? BETWEEN min_value AND max_value',
        [bmi]
      );

      if (bmiCategories.length === 0) {
        return res.status(400).json({ message: 'Invalid BMI value' });
      }

      const bmiCategory = bmiCategories[0];
    
      [meals] = await pool.query(
        `SELECT meal_type, food_items, calories FROM meal_plans
         WHERE diet_type = ? AND bmi_category_id = ?
         ORDER BY FIELD(meal_type, 'breakfast', 'snack', 'lunch', 'dinner')`,
        [dietType, bmiCategory.id]
      );
    }
    
    if (meals.length === 0) {
      return res.status(404).json({ 
        message: 'No meal plan found for this combination' 
      });
    }

    // Calculate total calories
    const totalCalories = meals.reduce((sum, meal) => sum + meal.calories, 0);

    res.json({
      dietType,
      bmiCategory: specialPlans.includes(dietType) ? 'Standard' : bmiCategories[0].category,
      meals,
      totalCalories
    });

  } catch (err) {
    console.error('Meal Plan Error:', err);
    res.status(500).json({ message: 'Failed to fetch meal plan' });
  }
});

// Register route
app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const query = 'INSERT INTO users (name, email, password) VALUES (?, ?, ?)';
    const [result] = await pool.query(query, [name, email, password]);
    res.status(200).json({ message: 'Registration successful!' });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ 
      message: err.code === 'ER_DUP_ENTRY' 
        ? 'Email already registered' 
        : 'Registration failed' 
    });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const query = 'SELECT * FROM users WHERE email = ? AND password = ?';
    const [results] = await pool.query(query, [email, password]);

    if (results.length > 0) {
      // Store login time
      await pool.query('INSERT INTO login_history (email) VALUES (?)', [email]);
      res.status(200).json({ 
        message: 'Login successful',
        user: {
          id: results[0].id,
          name: results[0].name,
          email: results[0].email
        }
      });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

// Log plan selection
app.post('/api/log-selection', async (req, res) => {
  try {
    const { plan, bmi, userId } = req.body;
    
    if (!plan || !bmi) {
      return res.status(400).json({ message: 'Plan and BMI are required' });
    }

    // Get BMI category ID
    const [category] = await pool.query(
      'SELECT id FROM bmi_categories WHERE ? BETWEEN min_value AND max_value',
      [bmi]
    );

    if (!category || category.length === 0) {
      return res.status(400).json({ message: 'Invalid BMI value' });
    }

    await pool.query(
      'INSERT INTO selected_plans (user_id, plan_name, bmi, bmi_category_id) VALUES (?, ?, ?, ?)',
      [userId || null, plan, bmi, category[0].id]
    );
    
    res.status(200).json({ message: "Plan selection logged successfully" });
  } catch (err) {
    console.error('Selection Log Error:', err);
    res.status(500).json({ message: "Error saving selection data" });
  }
});

app.post('/ai/feedback', async (req, res) => {
  console.log('Received feedback:', req.body); // Debug 1
  
  try {
    const { plan, feedback, userId } = req.body;
    
    // Debug 2 - Verify values
    console.log('Parsed values:', { 
      plan: typeof plan, 
      feedback: typeof feedback, 
      userId: typeof userId 
    });

    const connection = await pool.getConnection();
    console.log('Database connection acquired'); // Debug 3
    
    try {
      // Debug 4 - Show final query parameters
      const queryParams = [userId || null, plan, feedback];
      console.log('Executing query with params:', queryParams);

      const [result] = await connection.query(
        `INSERT INTO user_feedback 
        (user_id, plan_name, feedback_type) 
        VALUES (?, ?, ?)`,
        queryParams
      );
      
      console.log('Insert result:', result); // Debug 5
      res.json({ success: true, insertedId: result.insertId });
      
    } catch (queryError) {
      console.error('Query error:', queryError);
      throw queryError;
    } finally {
      connection.release();
      console.log('Connection released'); // Debug 6
    }
  } catch (err) {
    console.error('Full error stack:', err.stack); // Debug 7
    res.status(500).json({ 
      error: 'Failed to save feedback',
      details: process.env.NODE_ENV === 'development' ? {
        message: err.message,
        code: err.code,
        sqlState: err.sqlState
      } : undefined
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

app.post('/api/log-nutrition', async (req, res) => {
      try {
        const { userId, food, calories, protein } = req.body;
        
        // Insert or update today's nutrition data
        await pool.query(`
          INSERT INTO daily_nutrition (user_id, date, food, calories, protein)
          VALUES (?, CURDATE(), ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            calories = calories + VALUES(calories),
            protein = protein + VALUES(protein)
        `, [userId, food, calories, protein]);
        
        res.json({ success: true });
      } catch (err) {
        console.error('Log Nutrition Error:', err);
        res.status(500).json({ message: 'Failed to log nutrition data' });
      }
    });

    // BMI History Endpoint
app.get('/api/bmi-history', async (req, res) => {
  try {
    const { userId } = req.query;
    console.log('Fetching BMI history for user:', userId); // Debug log
    
    const [history] = await pool.query(`
      SELECT bmi, result as category, created_at as date 
      FROM bmi_history 
      WHERE user_id = ? 
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);

    console.log('Database returned:', history); // Debug log
    
    if (!history) {
      return res.status(404).json({ error: 'No history found' });
    }
    
    res.json(history);
  } catch (err) {
    console.error('BMI History Error:', err);
    res.status(500).json({ 
      error: 'Database error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Recent Plans Endpoint


// Get selected plan
app.get('/api/selected-plan', async (req, res) => {
  try {
    const { userId } = req.query;
    const [plan] = await pool.query(`
      SELECT plan_name as name 
      FROM selected_plans 
      WHERE user_id = ? 
      ORDER BY selection_time DESC 
      LIMIT 1
    `, [userId]);

    res.json(plan[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

    app.post('/api/log-water', async (req, res) => {
      try {
        const { userId, amount } = req.body;
        
        // Insert or update today's water intake
        await pool.query(`
          INSERT INTO daily_nutrition (user_id, date, water)
          VALUES (?, CURDATE(), ?)
          ON DUPLICATE KEY UPDATE 
            water = water + VALUES(water)
        `, [userId, amount]);
        
        res.json({ success: true });
      } catch (err) {
        console.error('Log Water Error:', err);
        res.status(500).json({ message: 'Failed to log water intake' });
      }
    });

    function checkAuth() {
  const userId = localStorage.getItem('userId');
  if (!userId) {
    // Store current page to return after login
    const returnUrl = window.location.pathname + window.location.search;
    window.location.href = `login.html?returnUrl=${encodeURIComponent(returnUrl)}`;
    return false;
  }
  return true;
}

// Update this endpoint to prioritize selected plans
app.get('/api/recent-plans', async (req, res) => {
  try {
    const { userId } = req.query;
    
    // Get ALL selected plans (no limit)
    const [selectedPlans] = await pool.query(`
      SELECT 
        id, 
        plan_name as name, 
        DATE(selection_time) as date,
        'selected' as type,
        selection_time as raw_date
      FROM selected_plans
      WHERE user_id = ?
      ORDER BY selection_time DESC
    `, [userId]);

    // Get weekly plans (only if needed)
    const [weeklyPlans] = await pool.query(`
      SELECT 
        id, 
        plan_name as name, 
        DATE(created_at) as date,
        'weekly' as type,
        created_at as raw_date
      FROM weekly_plans
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 4
    `, [userId]);

    // Combine and sort all plans by date (newest first)
    const allPlans = [...selectedPlans, ...weeklyPlans]
      .sort((a, b) => new Date(b.raw_date) - new Date(a.raw_date))
      .slice(0, 4); // Only show 4 most recent

    res.json(allPlans);
  } catch (err) {
    console.error('Recent Plans Error:', err);
    res.status(500).json({ 
      error: 'Failed to load recent plans',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});
// Get weekly metrics for dashboard chart
// Add this to your server.js
// In server.js, update the chart-data endpoint:
app.get('/api/chart-data', async (req, res) => {
  try {
    const { userId } = req.query;
    
    // Get BMI history from database
    const [bmiHistory] = await pool.query(`
      SELECT bmi, DATE(created_at) as date 
      FROM bmi_history 
      WHERE user_id = ?
      ORDER BY created_at ASC
      LIMIT 7
    `, [userId]);

    // Prepare chart data
    const labels = bmiHistory.map(item => 
      new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    );
    
    const data = bmiHistory.map(item => parseFloat(item.bmi));

    res.json({
      success: true,
      data: {
        labels,
        datasets: [{
          label: 'BMI History',
          data,
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14, 165, 233, 0.1)'
        }]
      }
    });

  } catch (err) {
    console.error('Chart data error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load chart data' 
    });
  }
});
function getCurrentUserId() {
  const userId = localStorage.getItem('userId');
  if (!userId) {
    checkAuth();
    return null;
  }
  return userId;
}



    
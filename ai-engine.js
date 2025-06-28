class AIEngine {
  constructor() {
    this.feedbackLog = [];
    this.mealDatabase = {
      // Breakfast options
      breakfast: {
        'Underweight': [
          "Oatmeal with nuts and honey (500 cal)",
          "Avocado toast with eggs (450 cal)",
          "Smoothie with banana, peanut butter, and milk (600 cal)"
        ],
        'Normal': [
          "Greek yogurt with granola and berries (350 cal)",
          "Whole grain toast with eggs (400 cal)",
          "Smoothie bowl (300 cal)"
        ],
        // ... more categories
      },
      // Similar for lunch, dinner, snacks
    };

    

    this.tipsDatabase = [
      "Drink at least 8 glasses of water daily",
      "Include protein in every meal",
      "Eat colorful vegetables for varied nutrients",
      "Limit processed foods",
      "Get 7-8 hours of sleep for better metabolism"
    ];
  }

 
  logFeedback(plan, feedback, userId) {
    this.feedbackLog.push({
      plan,
      feedback,
      userId,
      timestamp: new Date()
    });
    
    // Simple "learning" - just track what plans get positive feedback
    console.log(`Logged feedback for ${plan}: ${feedback}`);
  }

  

  getPopularPlans() {
    // Simple analysis of feedback
    const positivePlans = this.feedbackLog
      .filter(f => f.feedback === 'positive')
      .map(f => f.plan);
    
    const planCounts = {};
    positivePlans.forEach(plan => {
      planCounts[plan] = (planCounts[plan] || 0) + 1;
    });
    
    return Object.entries(planCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([plan]) => plan);
  }


  decideMealPlan(bmi, preferences = {}) {
    const category = this.getBMICategory(bmi);
    const { vegetarian = false, glutenFree = false } = preferences;
    
    if (category === 'Underweight') {
      if (vegetarian) return "High-Calorie Vegetarian";
      return "Calorie-Dense Balanced";
    }
    
    if (category === 'Overweight' || category === 'Obese') {
      if (glutenFree) return "Low-Carb Gluten-Free";
      return "Balanced Weight Loss";
    }
    
    // Normal weight
    if (vegetarian && glutenFree) return "Gluten-Free Vegetarian";
    if (vegetarian) return "Balanced Vegetarian";
    return "Standard Balanced";
  }

  // Simple recommendation based on BMI
  getRecommendation(bmi, goal) {
    const category = this.getBMICategory(bmi);
    let recommendation = "";
    
    if (category === 'Underweight' && goal === 'gain') {
      recommendation = "Focus on calorie-dense foods like nuts, avocados, and healthy fats";
    } else if (category === 'Overweight' && goal === 'lose') {
      recommendation = "Increase vegetable intake and reduce refined carbs";
    } else {
      recommendation = "Maintain balanced meals with proteins, carbs, and healthy fats";
    }
    
    return {
      recommendation,
      meals: this.generateSampleMeals(category, goal)
    };
  }

  getBMICategory(bmi) {
    bmi = parseFloat(bmi);
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25) return 'Normal';
    if (bmi < 30) return 'Overweight';
    return 'Obese';
  }

  generateSampleMeals(category, goal) {
    return {
      breakfast: this.mealDatabase.breakfast[category] || [],
      lunch: [
        "Grilled chicken with quinoa and vegetables",
        "Lentil soup with whole grain bread"
      ],
      dinner: [
        "Salmon with roasted sweet potatoes",
        "Stir-fried tofu with brown rice"
      ]
    };
  }

  getRandomTip() {
    return this.tipsDatabase[Math.floor(Math.random() * this.tipsDatabase.length)];
  }
}



// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIEngine;
}
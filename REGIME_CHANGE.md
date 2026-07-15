Regime Change

Need and General Theory

1. Mass-consumer time mgmt/todo/calendar/goal-tracking/project mgmt apps are bad. At most, these apps do one thing well -- one narrow slice of the pie has its needs met.

2. Given the game-change represented by vibe coding, we can instead design a highly personalized time mgmt app.

3. Our general theory will be to narrowly define custom types. E.g., rather than have recurring and non-recurring events, we propose instead to have mealplans, workouts, one-off todos, one-off projects, etc all have their own custom types with custom behavior. The catch is that, because they need to integrate into a single todo-calendar, each custom type will have its own predefined way of doing that, the same way e.g. most Ruby objects define a :to_s(). Items like workout and mealplan which are highly recurring and should not require user eyeballs most of the day will paint themselves into the calendar at predefined times but will not display their todo checklists unless clicked on. On the other hand, the day's work tasks, being that we need to think about them for more hours of the day, will by default display their todo-lists.

4. Further customization: cumulative data views (streak counts, weight/rep logging at gym).

5. Regimes

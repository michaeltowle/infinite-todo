1. Get hosted on CF
   test: whether we get a 404 at michaeltowle.io/todo.html

2. Lock down michaeltowle.io for anyone but me
   whitelisted device: log in once per month
   other device: login button triggers CF email with OTP
   robots and others should see login button always
   but won't they just click it all the time, being robots? ig that's why we need an email field, so the OTP email only triggers if my email is entered

3. Enable edits to todos.html which persist across devices and sessions
   many paths here. not a given that we choose D1.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const tallyResolver = require('./middleware/tallyResolver');

const app = express();

app.use(cors());
app.use(express.json());
app.use(tallyResolver);

app.use('/api', routes);

app.use(errorHandler);

app.listen(process.env.PORT, () => {
    console.log(`Server running on ${process.env.PORT}`);
});
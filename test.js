var ps = require('ps-node');

ps.lookup({
        command: 'node'
    },
    function(err, results) {

        if (err) {
            throw new Error(err);
        }

        console.log(results);
    }
);
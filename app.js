const express = require('express');
const admin = require('firebase-admin');

const app = express();

const serviceAccount = require('./madden-companion-project-firebase-adminsdk-u16ts-0a223df9a2.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://madden-companion-project-default-rtdb.firebaseio.com',
});

app.set('port', process.env.PORT || 3001);

const parseBody = (req) =>
    new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch (error) {
                reject(error);
            }
        });

        req.on('error', reject);
    });

const ensureExportPathExists = async (req, res, next) => {
    const db = admin.database();
    const {
        params: { username },
    } = req;

    try {
        const exportPath = `data/${username}`;
        const snapshot = await db.ref(exportPath).get();

        if (!snapshot.exists()) {
            res.status(403).send(
                `Export blocked: endpoint '${username}' must already exist in the database.`,
            );
            return;
        }

        next();
    } catch (error) {
        console.error('Failed to verify export endpoint:', error);
        res.status(500).send('Unable to validate export endpoint.');
    }
};

app.get('*', (req, res) => {
    res.send('Madden Companion Exporter');
});

app.post('/:username/:platform/:leagueId/leagueteams', ensureExportPathExists, async (req, res) => {
    const db = admin.database();
    const ref = db.ref();

    try {
        const { leagueTeamInfoList: teams = [] } = await parseBody(req);
        const {
            params: { username, leagueId },
        } = req;

        teams.forEach(team => {
            const teamRefPath = `data/${username}/${leagueId}/teams/${team.teamId}`;
            ref.child(teamRefPath).update(team);
        });

        res.sendStatus(200);
    } catch (error) {
        console.error('Error parsing JSON:', error);
        res.status(400).send('Invalid JSON format');
    }
});

app.post('/:username/:platform/:leagueId/standings', ensureExportPathExists, async (req, res) => {
    const db = admin.database();
    const ref = db.ref();

    try {
        const { teamStandingInfoList: teams = [] } = await parseBody(req);
        const {
            params: { username, leagueId },
        } = req;

        teams.forEach(team => {
            const teamRef = ref.child(`data/${username}/${leagueId}/teams/${team.teamId}`);
            teamRef.set(team);
        });

        res.sendStatus(200);
    } catch (error) {
        console.error('Error parsing JSON:', error);
        res.status(400).send('Invalid JSON format');
    }
});

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

app.post(
    '/:username/:platform/:leagueId/week/:weekType/:weekNumber/:dataType',
    ensureExportPathExists,
    async (req, res) => {
        const db = admin.database();
        const ref = db.ref();
        const {
            params: { username, leagueId, weekType, weekNumber, dataType },
        } = req;
        const basePath = `data/${username}/${leagueId}/`;
        const statsPath = `${basePath}stats`;

        try {
            const payload = await parseBody(req);

            switch (dataType) {
                case 'schedules': {
                    const weekRef = ref.child(`${basePath}schedules/${weekType}/${weekNumber}`);
                    const { gameScheduleInfoList: schedules = [] } = payload;
                    weekRef.set(schedules);
                    break;
                }
                case 'teamstats': {
                    const { teamStatInfoList: teamStats = [] } = payload;
                    teamStats.forEach(stat => {
                        const weekRef = ref.child(
                            `${statsPath}/${weekType}/${weekNumber}/${stat.teamId}/team-stats`,
                        );
                        weekRef.set(stat);
                    });
                    break;
                }
                case 'defense': {
                    const { playerDefensiveStatInfoList: defensiveStats = [] } = payload;
                    defensiveStats.forEach(stat => {
                        const weekRef = ref.child(
                            `${statsPath}/${weekType}/${weekNumber}/${stat.teamId}/player-stats/${stat.rosterId}`,
                        );
                        weekRef.set(stat);
                    });
                    break;
                }
                default: {
                    const property = `player${capitalizeFirstLetter(dataType)}StatInfoList`;
                    const stats = payload[property];

                    if (Array.isArray(stats)) {
                        stats.forEach(stat => {
                            const weekRef = ref.child(
                                `${statsPath}/${weekType}/${weekNumber}/${stat.teamId}/player-stats/${stat.rosterId}`,
                            );
                            weekRef.set(stat);
                        });
                    } else {
                        console.error('Expected property not found or is not an array:', property);
                    }
                }
            }

            res.sendStatus(200);
        } catch (error) {
            console.error('Error parsing JSON or accessing property:', error);
            res.status(400).send('Invalid JSON format');
        }
    },
);

app.post('/:username/:platform/:leagueId/freeagents/roster', ensureExportPathExists, async (req, res) => {
    const db = admin.database();
    const ref = db.ref();
    const {
        params: { username, leagueId },
    } = req;

    try {
        const { rosterInfoList = [] } = await parseBody(req);
        const dataRef = ref.child(`data/${username}/${leagueId}/freeagents`);
        const players = {};

        rosterInfoList.forEach(player => {
            players[player.rosterId] = player;
        });

        dataRef.set(players, error => {
            if (error) {
                console.log('Data could not be saved.' + error);
            } else {
                console.log('Data saved successfully.');
            }
        });

        res.sendStatus(200);
    } catch (error) {
        console.error('Error parsing JSON:', error);
        res.status(400).send('Invalid JSON format');
    }
});

app.post('/:username/:platform/:leagueId/team/:teamId/roster', ensureExportPathExists, async (req, res) => {
    const db = admin.database();
    const ref = db.ref();
    const {
        params: { username, leagueId, teamId },
    } = req;

    try {
        const { rosterInfoList = [] } = await parseBody(req);
        const dataRef = ref.child(`data/${username}/${leagueId}/teams/${teamId}/roster`);
        const players = {};

        rosterInfoList.forEach(player => {
            players[player.rosterId] = player;
        });

        dataRef.set(players, error => {
            if (error) {
                console.log('Data could not be saved.' + error);
            } else {
                console.log('Data saved successfully.');
            }
        });

        res.sendStatus(200);
    } catch (error) {
        console.error('Error parsing JSON:', error);
        res.status(400).send('Invalid JSON format');
    }
});

app.listen(app.get('port'), () => console.log('Madden Data is running on port', app.get('port')));

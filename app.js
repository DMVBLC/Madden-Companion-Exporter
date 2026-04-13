const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');

const app = express();

const serviceAccount = require("./madden-companion-project-firebase-adminsdk-u16ts-0a223df9a2.json");

admin.initializeApp({
   credential: admin.credential.cert(serviceAccount),
   databaseURL: "https://madden-companion-project-default-rtdb.firebaseio.com"
});

app.set('port', (process.env.PORT || 3001));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

function markLeagueExport(ref, username, leagueId) {
    return ref.child(`data/${username}/${leagueId}/lastExportedAt`).set(Date.now());
}

function markRosterExport(ref, username, leagueId) {
    return ref.child(`data/${username}/${leagueId}/rosterLastUpdated`).set(Date.now());
}

/* =====================================================
   ✅ MIDDLEWARE: CHECK IF USER EXISTS
===================================================== */
async function validateUser(req, res, next) {
    try {
        const db = admin.database();
        const { username } = req.params;

        const snapshot = await db.ref(`data/${username}`).once('value');

        if (!snapshot.exists()) {
            return res.status(404).send({
                error: `User '${username}' does not exist. Export cancelled.`,
            });
        }

        next();
    } catch (err) {
        console.error('Validation error:', err);
        return res.status(500).send({
            error: 'Internal server error during validation',
        });
    }
}

/* =====================================================
   BASIC ROUTE
===================================================== */
app.get('*', (req, res) => {
    res.send('Madden Companion Exporter');
});

/* =====================================================
   LEAGUE TEAMS
===================================================== */
app.post('/:username/:platform/:leagueId/leagueteams', validateUser, (req, res) => {
    const db = admin.database();
    const ref = db.ref();

    const {
        params: { username, leagueId },
        body: { leagueTeamInfoList: teams },
    } = req;

    teams.forEach(team => {
        const teamRef = ref.child(
            `data/${username}/${leagueId}/teams/${team.teamId}`
        );
        teamRef.update(team);
    });

    markLeagueExport(ref, username, leagueId);
    res.sendStatus(200);
});

/* =====================================================
   STANDINGS
===================================================== */
app.post('/:username/:platform/:leagueId/standings', validateUser, (req, res) => {
    const db = admin.database();
    const ref = db.ref();

    const {
        params: { username, leagueId },
        body: { teamStandingInfoList: teams },
    } = req;

    teams.forEach(team => {
        const teamRef = ref.child(
            `data/${username}/${leagueId}/teams/${team.teamId}`
        );
        teamRef.update(team);
    });

    markLeagueExport(ref, username, leagueId);
    res.sendStatus(200);
});

/* =====================================================
   WEEKLY DATA
===================================================== */
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

app.post(
    '/:username/:platform/:leagueId/week/:weekType/:weekNumber/:dataType',
    validateUser,
    (req, res) => {
        const db = admin.database();
        const ref = db.ref();

        const {
            params: { username, leagueId, weekType, weekNumber, dataType },
        } = req;

        const basePath = `data/${username}/${leagueId}/`;
        const statsPath = `${basePath}stats`;

        switch (dataType) {
            case 'schedules': {
                const weekRef = ref.child(
                    `${basePath}schedules/${weekType}/${weekNumber}`
                );
                const {
                    body: { gameScheduleInfoList: schedules },
                } = req;

                weekRef.set(schedules);
                break;
            }

            case 'teamstats':
            case 'team': {
                const {
                    body: { teamStatInfoList: teamStats },
                } = req;

                teamStats.forEach(stat => {
                    const weekRef = ref.child(
                        `${statsPath}/${weekType}/${weekNumber}/${stat.teamId}/team-stats`
                    );
                    weekRef.update(stat);
                });
                break;
            }

            case 'defense': {
                const {
                    body: { playerDefensiveStatInfoList: defensiveStats },
                } = req;

                defensiveStats.forEach(stat => {
                    const weekRef = ref.child(
                        `${statsPath}/${weekType}/${weekNumber}/${stat.teamId}/player-stats/${stat.rosterId}`
                    );
                    weekRef.update(stat);
                });
                break;
            }

            default: {
                const { body } = req;
                const property = `player${capitalizeFirstLetter(dataType)}StatInfoList`;
                const stats = body[property];

                stats.forEach(stat => {
                    const weekRef = ref.child(
                        `${statsPath}/${weekType}/${weekNumber}/${stat.teamId}/player-stats/${stat.rosterId}`
                    );
                    weekRef.update(stat);
                });
                break;
            }
        }

        markLeagueExport(ref, username, leagueId);
        res.sendStatus(200);
    }
);

/* =====================================================
   FREE AGENTS ROSTER
===================================================== */
app.post('/:username/:platform/:leagueId/freeagents/roster', validateUser, (req, res) => {
    const db = admin.database();
    const ref = db.ref();

    const {
        params: { username, leagueId }
    } = req;

    let body = '';

    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {
        const { rosterInfoList } = JSON.parse(body);

        const dataRef = ref.child(
            `data/${username}/${leagueId}/freeagents`
        );

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

        markRosterExport(ref, username, leagueId);
        res.sendStatus(200);
    });
});

/* =====================================================
   TEAM ROSTER
===================================================== */
app.post('/:username/:platform/:leagueId/team/:teamId/roster', validateUser, (req, res) => {
    const db = admin.database();
    const ref = db.ref();

    const {
        params: { username, leagueId, teamId },
        body: { rosterInfoList },
    } = req;

    const dataRef = ref.child(
        `data/${username}/${leagueId}/teams/${teamId}/roster`
    );

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

    markRosterExport(ref, username, leagueId);
    res.sendStatus(200);
});

/* =====================================================
   START SERVER
===================================================== */
app.listen(app.get('port'), () =>
    console.log('Madden Data is running on port', app.get('port'))
);

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
app.post('/:username/:platform/:leagueId/leagueteams', validateUser, async (req, res) => {
    try {
        const db = admin.database();
        const ref = db.ref();

        const {
            params: { username, leagueId },
            body: { leagueTeamInfoList: teams },
        } = req;

        await Promise.all(
            teams.map(team => {
                const teamRef = ref.child(
                    `data/${username}/${leagueId}/teams/${team.teamId}`
                );
                return teamRef.update(team);
            })
        );

        await markLeagueExport(ref, username, leagueId);
        res.sendStatus(200);
    } catch (error) {
        console.error('League teams export failed:', error);
        res.status(500).send({
            error: 'League teams export failed',
            details: error.message,
        });
    }
});

/* =====================================================
   STANDINGS
===================================================== */
app.post('/:username/:platform/:leagueId/standings', validateUser, async (req, res) => {
    try {
        const db = admin.database();
        const ref = db.ref();

        const {
            params: { username, leagueId },
            body: { teamStandingInfoList: teams },
        } = req;

        await Promise.all(
            teams.map(team => {
                const teamRef = ref.child(
                    `data/${username}/${leagueId}/teams/${team.teamId}`
                );
                return teamRef.update(team);
            })
        );

        await markLeagueExport(ref, username, leagueId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Standings export failed:', error);
        res.status(500).send({
            error: 'Standings export failed',
            details: error.message,
        });
    }
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
    async (req, res) => {
        try {
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

                    if (!Array.isArray(schedules) && (typeof schedules !== 'object' || schedules === null)) {
                        return res.status(400).send({
                            error: 'gameScheduleInfoList is missing or invalid',
                        });
                    }

                    await weekRef.update(schedules);
                    break;
                }

                case 'teamstats':
                case 'team': {
                    const {
                        body: { teamStatInfoList: teamStats },
                    } = req;

                    if (!Array.isArray(teamStats)) {
                        return res.status(400).send({
                            error: 'teamStatInfoList is missing or invalid',
                        });
                    }

                    await Promise.all(
                        teamStats.map(stat => {
                            const weekRef = ref.child(
                                `${statsPath}/${weekType}/${weekNumber}/${stat.teamId}/team-stats`
                            );
                            return weekRef.update(stat);
                        })
                    );
                    break;
                }

                case 'defense': {
                    const {
                        body: { playerDefensiveStatInfoList: defensiveStats },
                    } = req;

                    if (!Array.isArray(defensiveStats)) {
                        return res.status(400).send({
                            error: 'playerDefensiveStatInfoList is missing or invalid',
                        });
                    }

                    await Promise.all(
                        defensiveStats.map(stat => {
                            const weekRef = ref.child(
                                `${statsPath}/${weekType}/${weekNumber}/${stat.teamId}/player-stats/${stat.rosterId}`
                            );
                            return weekRef.update(stat);
                        })
                    );
                    break;
                }

                default: {
                    const { body } = req;
                    const property = `player${capitalizeFirstLetter(dataType)}StatInfoList`;
                    const stats = body[property];

                    if (!Array.isArray(stats)) {
                        return res.status(400).send({
                            error: `${property} is missing or invalid`,
                        });
                    }

                    await Promise.all(
                        stats.map(stat => {
                            const weekRef = ref.child(
                                `${statsPath}/${weekType}/${weekNumber}/${stat.teamId}/player-stats/${stat.rosterId}`
                            );
                            return weekRef.update(stat);
                        })
                    );
                    break;
                }
            }

            await markLeagueExport(ref, username, leagueId);
            res.sendStatus(200);
        } catch (error) {
            console.error('Weekly export failed:', error);
            res.status(500).send({
                error: 'Weekly export failed',
                details: error.message,
            });
        }
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

    req.on('end', async () => {
        try {
            const { rosterInfoList } = JSON.parse(body);

            const dataRef = ref.child(
                `data/${username}/${leagueId}/freeagents`
            );

            const players = {};
            rosterInfoList.forEach(player => {
                players[player.rosterId] = player;
            });

            await dataRef.set(players);
            await markRosterExport(ref, username, leagueId);
            res.sendStatus(200);
        } catch (error) {
            console.error('Free agents roster export failed:', error);
            res.status(500).send({
                error: 'Free agents roster export failed',
                details: error.message,
            });
        }
    });
});

/* =====================================================
   TEAM ROSTER
===================================================== */
app.post('/:username/:platform/:leagueId/team/:teamId/roster', validateUser, async (req, res) => {
    try {
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

        await dataRef.set(players);
        await markRosterExport(ref, username, leagueId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Team roster export failed:', error);
        res.status(500).send({
            error: 'Team roster export failed',
            details: error.message,
        });
    }
});

/* =====================================================
   START SERVER
===================================================== */
app.listen(app.get('port'), () =>
    console.log('Madden Data is running on port', app.get('port'))
);

/* =====================================================
   START SERVER
===================================================== */
app.listen(app.get('port'), () =>
    console.log('Madden Data is running on port', app.get('port'))
);

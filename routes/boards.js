var express = require('express');
var HTTPStatus = require("http-status");
var createError = require("http-errors");
var moment = require("moment");
var db = require("../models/index.js");
var sequelize = db.sequelize;
var Sequelize = db.Sequelize;

var router = express.Router();

function verifyAccess(req, res, next) {
    const user_id = req.session.id;
    const boardId = req.params.id;
    const query = `SELECT DISTINCT "b"."id" FROM "boards" b
                        INNER JOIN "users" u ON "u"."id" = "b"."ownerId"
                        LEFT JOIN "teamUsers" tu ON "b"."teamId" = "tu"."teamId"
                        WHERE (:id = "b"."ownerId" OR :id = "tu"."userId") AND ("b"."id" = :boardId);`;
    sequelize.query(query, {replacements: {id: user_id, boardId: boardId}, type: sequelize.QueryTypes.SELECT}).then(function(response) {
        if(response.length === 0)
            next(createError(HTTPStatus.UNAUTHORIZED, "User does not have access to this board"));
        else   
            next();
    }).catch(function(thrown) {
        next(createError(HTTPStatus.UNAUTHORIZED, "User does not have access to this board"));
    });
}

router.get("/", function(req, res, next) {
    res.render("boards", {});
});

router.get("/all", function(req, res, next) {
    const query = `SELECT "t"."id" "teamId", "t"."name" "teamName",  json_agg("b".*) "boards" FROM "boards" b
                    FULL OUTER JOIN "teams" t
                        ON "b"."teamId" = "t"."id"
                    LEFT JOIN "teamUsers" tu
                        ON "t"."id" = "tu"."teamId" AND :id = "tu"."userId"
                    WHERE "tu"."userId" = :id OR "b"."ownerId" = :id
                    GROUP BY "t"."id";`;
    const uid = req.session.id;
    sequelize.query(query, {replacements: {id: uid}, type: sequelize.QueryTypes.SELECT}).then(function(response) {
        res.json(response);
    }).catch(function(thrown) {
        next(createError(HTTPStatus.INTERNAL_SERVER_ERROR, "Could not retrieve boards"));
    });
});

router.get("/personal", function(req, res, next) {
    const uid = req.session.id;
    sequelize.query(`SELECT * FROM boards WHERE "ownerId" = :id`, {replacements: {id: uid}}).then(function(response) {
        res.json(response[0]);
    }).catch(function(thrown) {
        res.render("index", {});
        next(createError(HTTPStatus.BAD_REQUEST, "ID must be an integer"));
    });
});

router.get("/team/:id", function(req, res, next) {
    const uid = req.session.id;
    const teamId = req.params.id;
    if(teamId === undefined || teamId.trim() === "")
        next(createError(HTTPStatus.BAD_REQUEST, "Invalid Team ID"));
    else {
        const query = `SELECT * FROM "boards" WHERE "teamId" = :teamId AND EXISTS (SELECT * FROM "teamUsers" WHERE "teamId" = :teamId AND "userId" = :uid)`;
        sequelize.query(query, {replacements: {teamId: teamId, uid: uid}, type: sequelize.QueryTypes.SELECT}).then(function(response) {
            res.json(response);
        }).catch(function(thrown) {
            next(createError(HTTPStatus.BAD_REQUEST, "Invalid Team ID"));
        });
    }
});

router.post("/", function(req, res, next) {
    const name = req.body.name;
    const teamId = req.body.teamId;
    const ownerId = req.session.id;
    if(ownerId === undefined || name === undefined || name.trim() === "")
        next(createError(HTTPStatus.BAD_REQUEST, "Invalid input"));
    else {
        if(teamId != undefined) {
            const q1 = `SELECT * FROM "teamUsers" WHERE "teamId" = :teamId`;
            sequelize.query(q1, {replacements: {teamId: teamId}, type: sequelize.QueryTypes.SELECT}).then(function(response) {
                if(response.length > 0 && response.find(function(obj) {
                    return obj.userId === ownerId;
                }) != undefined) {
                    const query = `INSERT INTO "boards" VALUES (DEFAULT, :ownerid, :teamid, :title, :lastviewed) RETURNING *`;
                    sequelize.query(query, {replacements: {ownerid: ownerId, teamid: teamId, title: name.trim(), lastviewed: moment.utc(new Date()).format('YYYY-MM-DD HH:mm:ss.SSS Z')}, type: sequelize.QueryTypes.INSERT}).then(function(response) {
                        res.json(response[0][0]);
                    }).catch(function(thrown) {
                        next(createError(HTTPStatus.INTERNAL_SERVER_ERROR, "Problem inserting board"));
                    });
                }
                else {
                    next(createError(HTTPStatus.BAD_REQUEST, "Invalid team ID"));
                }
            }).catch(function(thrown) {
                next(createError(HTTPStatus.BAD_REQUEST, "Invalid team ID"));
            });
        }
        else {
            const query = `INSERT INTO "boards" VALUES (DEFAULT, :ownerid, NULL, :title, :lastviewed) RETURNING *`;
            sequelize.query(query, {replacements: {ownerid: ownerId, title: name.trim(), lastviewed: moment.utc(new Date()).format('YYYY-MM-DD HH:mm:ss.SSS Z')}, type: sequelize.QueryTypes.INSERT}).then(function(response) {
                res.json(response[0][0]);
            }).catch(function(thrown) {
                next(createError(HTTPStatus.INTERNAL_SERVER_ERROR, "Problem inserting board"));
            });
        }
    }
});

router.get("/:id", verifyAccess, function(req, res, next) {
    const boardId = req.params.id;
    const q1 = `SELECT "l"."id", "l"."name", json_agg("c2".*) cards
                        FROM "lists" "l"
                        LEFT JOIN (SELECT * FROM "cards" ORDER BY "order" ASC, "createdAt" ASC) "c2" ON "l"."id" = "c2"."listId"
                        WHERE "l"."boardId" = :boardId
                        GROUP BY "l"."id"
                        ORDER BY "l"."order" ASC, "l"."createdAt" ASC;`;
    const q2 = `UPDATE "boards"
                    SET "lastViewed" = :date
                    WHERE "id" = :boardId;`
    sequelize.query(q1, {replacements: {boardId: boardId}, type: sequelize.QueryTypes.SELECT}).then(function(response) {
        for(let i = 0; i < response.length; ++i) {
            if(response[i].cards[0] === null) {
                response[i].cards = [];
            }
        }
        sequelize.query(q2, {replacements: {date: moment.utc(new Date()).format('YYYY-MM-DD HH:mm:ss.SSS Z'), boardId: boardId}, type: sequelize.QueryTypes.UPDATE}).then(function(q2_response) {
            res.render("lists", {lists: response, board_id: req.params.id});
        }).catch(function(thrown) {
            next(createError(HTTPStatus.BAD_REQUEST, "Invalid board ID"));
        });
    }).catch(function(thrown) {
        next(createError(HTTPStatus.BAD_REQUEST, "Invalid board ID"));
    });
});

router.patch("/:id/lists/", verifyAccess, function(req, res, next) {
    const lists = req.body['lists[]'];
    const boardId = req.params.id;
    if(lists === undefined || !Array.isArray(lists)) {
        next(createError(HTTPStatus.BAD_REQUEST, "Invalid list array"));
    }
    else {
        let promises = [];
        for(let i = 0; i < lists.length; ++i) {
            const query = `UPDATE "lists"
                                SET "order" = :newOrder
                                WHERE "id" = :listId AND "boardId" = :boardId;`;
            promises.push(sequelize.query(query, {replacements: {newOrder: i, listId: lists[i], boardId: boardId}, type: sequelize.QueryTypes.UPDATE}));
        }
        Promise.all(promises).then(function(response) {
            res.json(response);
        }).catch(function(thrown) {
            console.log(thrown);
            next(createError(HTTPStatus.BAD_REQUEST, "Invalid input; unable to update list order"));
        });   
    }
});
module.exports = router;
/**
 * Created by championswimmer on 25/11/16.
 */
const Sequelize = require('sequelize');
const r = require('convert-radix64');
const axios = require('axios');
const uid = require('uid2');
var secrets;
try {
    secrets = require('./../secrets.json');
} catch (e) {
    secrets = require('./../secrets-sample.json');
}
//This is so that BIGINT is treated at integer in JS
require('pg').defaults.parseInt8 = true;
//We have made sure that we do not use integers larger than 2^53 in our logic

const DB_HOST = secrets.DB.HOST || "localhost";
const DB_USER = secrets.DB.USERNAME || "shorturl";
const DB_PASS = secrets.DB.PASSWORD || "shorturl";
const DB_NAME = secrets.DB.DB_NAME || "shorturl";
const DB_PORT = secrets.DB.PORT || 5432;

const DATABASE_URL = process.env.SHORTLR_DATABASE_URL ||
  (`postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);

const sequelize = new Sequelize(DATABASE_URL, {
  host: DB_HOST,
  dialect: 'postgres',

  pool: {
    max: 5,
    min: 0,
    idle: 10000
  },
});


const URL = sequelize.define('url', {
  code: {type: Sequelize.BIGINT, primaryKey: true},
  codeStr: {type: Sequelize.STRING, unique: true},
  longURL: {type: Sequelize.STRING},
  hits: {type: Sequelize.INTEGER, defaultValue: 0}
});

const Event = sequelize.define('event', {
  time: {type: Sequelize.DATE},
  from: {type: Sequelize.STRING}
});

const Alias = sequelize.define('alias', {});

const User = sequelize.define('user', {
  name: {type: Sequelize.STRING},
  email: {type: Sequelize.STRING}
});

Event.belongsTo(URL);


const OneAuth = sequelize.define('authtoken', {
  id: {type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true},
  oneauthId: Sequelize.INTEGER,
  oneauthToken: Sequelize.STRING,
  token: Sequelize.STRING
});

OneAuth.belongsTo(User);
User.hasMany(OneAuth);

const Group = sequelize.define('group', {
  id: {type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true},
  groupName: Sequelize.STRING
});


sequelize.sync(); //Normal case
//sequelize.sync({force: true}); //If schema changes NOTE: It will drop/delete old data


module.exports = {
  addUrl: function (code, longURL, alias, done, failed) {
    if (!alias) {
      URL.findOrCreate({
        where: {
          code: code
        },
        defaults: {
          code: code,
          codeStr: r.to64(code),
          longURL: longURL
        }

      }).spread(function (url, created) {
        done(url.codeStr, !created, url.longURL);
      }).catch(function (error) {
        console.log(error);
        failed(error);
      })
    } else {
      //TODO: handle longer than 9 with alias map
    }
  },
  fetchUrl: function (code, from, done, failed) {
    URL.findById(code).then(function (url) {
      done(url.longURL);
      Event.create({
        from: from,
        time: new Date(),
        urlCode: url.code
      }).then(function () {
        url.increment('hits')
      });
    }).catch(function (error) {
      failed(error)
    })
  },
  fetchLongUrl: function (longURL, done, failed) {
    URL.findAll({
      where: {
        longURL: longURL
      }
    }).then(function (urls) {
      done(urls);
    }).catch(function (err) {
      console.log(err);
      failed(err);
    })
  },
  urlStats: function ({page, size}) {

    const offset = (page - 1) * size;
    return URL.findAndCountAll({
      order: [['hits', 'DESC']],
      limit: size,
      offset: offset
    }).then(data => {
      if (offset > data.count || offset < 0)
        throw new Error('Pagination Error : Out of Error Range');

      const lastPage = Math.ceil(data.count / size);
      return {urls: data.rows, lastPage};
    });
  },
  authFunction: function (authtoken, done) {
    OneAuth.findOne({
      where: {
        oneauthToken: authtoken.data.access_token
      },
      include: User
    }).then(function (oneauth) {
      if (oneauth !== null) {
        done({
          success: true,
          token: oneauth.token,
          user: oneauth.user.name
        })
      }
      else {
        axios.get('https://account.codingblocks.com/api/users/me', {
          headers: {'Authorization': `Bearer ${authtoken.data.access_token}`}
        }).then(function (user) {
          OneAuth.create({
            user: {
              name: user.data.firstname + " " + user.data.lastname,
              email: user.data.email
            }
            , oneauthToken: authtoken.data.access_token
            , token: uid(30)
          }, {
            include: [User]
          }).then(function (oneauthFinal) {
            done({
              success: true,
              token: oneauthFinal.token,
              user: user.data.firstname + " " + user.data.lastname
            })
          }).catch(function (err) {
            console.log(err);
            done({
              success: false
              , code: "500"
              , error: {
                message: "Could not create in Oneauth Table(Internal Server Error)."
              }
            })
          })
        }).catch(function (err) {
          console.log(err);
          done({
            success: false
            , code: "500"
            , error: {
              message: "Could not get details from Oneauth API(Internal Server Error)."
            }
          })
        })
      }
    }).catch(function (err) {
      console.log(err);
      done({
        success: false
        , code: "500"
        , error: {
          message: "Could not find in Oneauth(Internal Server Error)."
        }
      })
    })
  },
  models:
    {
      Group
    }

};
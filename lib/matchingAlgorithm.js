// Table: PlayerData
// Variable Names:
// winLoss: Float
// type: String (Post MVP)
// winVelocity: Float
// rank: String
// winStreak: Integer

// in order of linked list {1:{id: stats}, 2:{id: stats}}
var LinkedList = require('../server/linkedList');
// initializing the coefficient values to multiply eaxh x by,
// this gives weighting to the x1, x2 ... xn
var thetas = {winLossRatio: 1, winVelocity: 1.2, elo: 1.5, winStreak: 0.7};
var features = Object.keys({winLossRatio: true, winVelocity: true, elo: true, winStreak: true});

var Ranking = require('./rankingSystem');
var waitingForGame = require('../server/data').waitingForGame;


// not a deep clone, only handles copying primitives, nested objects,
// and arrays.
var cloneObj = function ( obj) {
  var answer = {};

  for ( var key in obj) {
    if ( typeof obj[key] === "object") {
      if ( !Array.isArray(obj[key])) {
        answer[key] = cloneObj(obj[key]);
      } else {
        answer[key] = obj[key];
      }
    } else {
      answer[key] = obj[key];
    }
  }

  return answer;
};

// finding the best opponent for a player to play
var findOpponent = function ( playerObj, otherPlayers, features, badMatches, naiveMatch) {
  // console.log(playerObj.avatarStats);
  var bestMatch = [Infinity, null];
  var otherPlayersKeys = Object.keys(otherPlayers);

  // initializing min and max with the player stats
  var min = cloneObj(playerObj.avatarStats);
  var max = cloneObj(playerObj.avatarStats);

  var rankMargin = 1;
  if (!naiveMatch) {
    // loosen the rank margin based on the rank of the player
    // players in lower divisions will receive a looser rank margin
    var playerRank = Ranking.determineRank(playerObj.avatarStats.elo);
    if ( playerRank >= 0 && playerRank <= 2) {
      rankMargin = 2;
    } else if ( playerRank === 10 || playerRank === 1) {
      rankMargin = 2;
    }
  }

  // filter out avatars with the same user id so users cant play themselves,
  // causing the match queue to break
  otherPlayersKeys.forEach( function ( name) {
    var player = otherPlayers[name];

    if (playerObj.userID === player.userID) {
      delete otherPlayers[name];
    }
  });

  otherPlayersKeys = Object.keys(otherPlayers);

  // scale each feature so that the values are within the same range
  // and exert the same influence on the overall algorithm
  // find the min and max for each feature in dataset
  otherPlayersKeys.forEach( function ( name) {
    var player = otherPlayers[name];
    var stats = player.avatarStats;

    // if the users searching for matchmaking is not within a one rank margin,
    // dont consider the user as a potential match. Also, the two users must be
    // able to match based on the callers specifications.
    // console.log(badMatches);
    // console.log(badMatches[playerObj.avatarID]);
    // console.log(badMatches[playerObj.avatarID][player.avatarID]);

    if ( naiveMatch || (Math.abs(Ranking.determineRank(stats.elo) - playerRank) <= rankMargin && (!badMatches[playerObj.avatarID] || !badMatches[playerObj.avatarID][player.avatarID]))) {
      features.forEach( function ( feature) {
        var val = stats[feature];

        if (val) {
          if ( val > max[feature]) {
            max[feature] = val;
          } else if ( val < min[feature] ) {
            min[feature] = val;
          }
        }
      });
    } else {
      delete otherPlayers[name];
    }
  });

  // if(naiveMatch) {
  //   console.log(playerObj);
  //   console.log(otherPlayers);
  // }

  otherPlayersKeys = Object.keys(otherPlayers);

  if (otherPlayersKeys.length === 0) {
    return false;
  }

  // scale the players stats
  features.forEach(function (feature) {
    var stats = playerObj.avatarStats;
    var val = stats[feature];
    if (val) {
      stats[feature] = (val + i - min[feature]) / (max[feature] - min[feature]);

      var i = 1;
      while (isNaN(stats[feature]) || stats[feature] === Infinity) {
        stats[feature] = (val + i - min[feature]) / (max[feature] - min[feature] + i);
        i++;
      }
    }
  });

  // perform feature scaling using the rescaling equation, scales each value from 0 to 1 relative to other data
  // points of same feature from all other potential matches.
  otherPlayersKeys.forEach( function ( name) {
    var stats = otherPlayers[name].avatarStats;

    features.forEach( function ( feature) {
      var val = stats[feature];
      if (val) {
        stats[feature] = (val - min[feature]) / (max[feature] - min[feature]);

        var i = 1;
        while (isNaN(stats[feature]) || stats[feature] === Infinity) {
          stats[feature] = (val + i - min[feature]) / (max[feature] - min[feature] + i);
          i++;
        }
      }
    });
  });
  // end of feature scaling

  // find the least euclidean distance of players searching for a match
  // to see which player most closely matches current player searching
  otherPlayersKeys.forEach( function ( name) {
    var playerStats = otherPlayers[name].avatarStats;
    var player1Stats = playerObj.avatarStats;
    var scaledDistance = 0;

    features.forEach(function ( feature) {
      if (playerStats[feature] && player1Stats[feature]) {
        scaledDistance += Math.pow((playerStats[feature] - player1Stats[feature]) * thetas[feature], 2);
      }
    });

    var distance = Math.sqrt(scaledDistance);

    if ( distance < bestMatch[0]) {
      bestMatch = [distance, [otherPlayers[name].avatarID, name]];
    }
  });

  // scale feature back to original value for testing purposes
  // for(feature in bestMatch[1]) {
  //   if(feature !== 'username') {
  //     bestMatch[1][feature] = bestMatch[1][feature] * (max[feature] - min[feature]) + min[feature];
  //   }
  // }

  return bestMatch[1];
};

var nonMatches = {};
var naiveBatch = new LinkedList();

var matchGroup = function (players, badMatches, naiveMatch) {
  var matchPairs = [];
  var matchesLeft = Object.keys(players).length;
  var batchRejects = {};

  // check if all players in group have same user id
  var curUserId;
  var likePlayers = 0;
  for (var key in players) {
    var player = players[key];
    // console.log(player.userID);

    if (!curUserId) {
      curUserId = player.userID;
    } else if (player.userID !== curUserId) {
      break;
    } else {
      likePlayers++;
    }
  }

  if (likePlayers >= matchesLeft) {
    return [[],[]];
  }

  while ( matchesLeft > 0 ) {
    var playerName = Object.keys(players)[0];
    var player1 = cloneObj(players[playerName]);
    var temp = players[playerName];
    delete players[playerName];

    var playersClone = cloneObj(players);

    // if(naiveMatch) {
    //   console.log(player1);
    //   console.log(players)
    //   console.log(naiveMatch);
    // }

    var player2 = findOpponent(player1, playersClone, features, badMatches, naiveMatch);

    // if there was a match, push the match pair to an array
    if ( player2) {
      if (naiveMatch) {
        naiveBatch.removeByAvatarID(player1.avatarID);
        naiveBatch.removeByAvatarID(player2[0]);
      }

      delete players[player2[1]];
      matchesLeft--;

      matchPairs.push([player1.avatarID, player2[0]]);
    } else {
      // the player didnt get matched, check if they have been in the queue for a while and
      // received no matches. If a player has been attempted to be matched 3 times then put them
      // in a batch to be naively matched together.
      if (!nonMatches[player1.avatarID] || nonMatches[player1.avatarID] < 2) {
        nonMatches[player1.avatarID.toString()] = nonMatches[player1.avatarID.toString()] || 0;
        batchRejects[playerName] = temp;
      } else {
        naiveBatch.addToBack(temp);
      }

      nonMatches[player1.avatarID]++;
    }

    matchesLeft--;
  }

  return [matchPairs, batchRejects];
};

var matchBatch = function (n, badMatches, naiveMatch, players) {
  players = players || waitingForGame;

  var batch = {};
  var batchRejects = new LinkedList();
  var curPlayer = players.head;

  if (!curPlayer || !curPlayer.next) {
    return [];
  }

  // var curPlayer = waitingForGame.head;
  var nextNode = curPlayer.next;
  var i = 0;

  var matches = [];
  var results;
  var key;
  var temp;

  // split the users in queue in to batches, and collect rejects from each batch
  while (curPlayer) {
    i++;

    if (i > n) {
      temp = cloneObj(batch);
      // var results = matchGroup(batch, badMatches, naiveMatch);
      results = matchGroup(players, waitingForGame.invalidMatches, naiveMatch);
      matches = matches.concat(results[0]);
      badMatches = results[1];

      for (key in badMatches) {
        batchRejects.addToBack(temp[key]);
      }

      i = 0;
      batch = {};
    }

    batch[i.toString()] = cloneObj(curPlayer.val);

    curPlayer = nextNode;
    if (curPlayer) {
      nextNode = curPlayer.next;
    }
  }

  if (Object.keys(batch).length > 0) {
    // temp = cloneObj(batch);

    // var results = matchGroup(batch, badMatches, naiveMatch);
    results = matchGroup(batch, waitingForGame.invalidMatches, naiveMatch);
    matches = matches.concat(results[0]);
    badMatches = results[1];

    for (key in badMatches) {
      batchRejects.addToBack(cloneObj(badMatches[key]));
    }
  }
  // end of batch splitting and collecting rejects

  // attempt to match the batch rejects
  if (batchRejects.head && batchRejects.head.next) {
    // var results = matchBatch(batchRejects, n, badMatches);
    results = matchBatch(n, waitingForGame.invalidMatches, false, batchRejects);

    results.forEach(function (res) {
      matches.push(res);
    });
  }

  // match anyone leftover using naive matching that did not get matched using
  // strict matching.
  if (naiveBatch.head && naiveBatch.next) {
    // var results = matchBatch(naiveBatch, n, badMatches, true);
    results = matchBatch(n, waitingForGame.invalidMatches, true, naiveBatch);

    results.forEach(function (res) {
      matches.push(res);
    });
  }

  return matches;
};

module.exports.matchBatch = matchBatch;
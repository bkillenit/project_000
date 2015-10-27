// Note: comments done with
// http://patorjk.com/software/taag/#p=display&f=Doom&t=Logger

//                       _              _ 
//                      (_)            | |
//  _ __ ___  __ _ _   _ _ _ __ ___  __| |
// | '__/ _ \/ _` | | | | | '__/ _ \/ _` |
// | | |  __/ (_| | |_| | | | |  __/ (_| |
// |_|  \___|\__, |\__,_|_|_|  \___|\__,_|
//              | |                       
//              |_|       

// Require sequelize
var Sequelize = require('sequelize');
// Require bcrypt
var bcrypt = require('bcrypt');

// Require rooms table
var roomsTable = require('./db_config.js').rooms;
// Require avatars table
var avatarsTable = require('./db_config.js').avatars;
// Require messages table
var messagesTable = require('./db_config.js').messages;

// Require messages helper
var messagesHelper = require('./messagesHelper');

// Require player game room queue
var waitingForGame = require('../server/data').waitingForGame;
// Require judging
var judging = require('../server/data').judging;

// Require socket helper
var socketHelper = require('../server/sockets').helper;

//                                _   _      _                 
//  _ __ ___   ___  _ __ ___  ___| | | | ___| |_ __   ___ _ __ 
// | '__/ _ \ / _ \| '_ ` _ \/ __| |_| |/ _ \ | '_ \ / _ \ '__|
// | | | (_) | (_) | | | | | \__ \  _  |  __/ | |_) |  __/ |   
// |_|  \___/ \___/|_| |_| |_|___/_| |_|\___|_| .__/ \___|_|   
//                                            |_|              

// Rooms helper master object
var roomsHelper = {};

// Rooms helper to get n rooms that need to be judged
// roomsHelper.getRoomsToJudge = function (data) {
//   // Get callback
//   var callback = data.callback;

//   // Get userID
//   var callback = data.callback;

//   // Room count limit
//   var roomLimit = data.roomLimit || 10;

//   // Get roomLimit rooms to judge
//   return roomsTable.findAll({
//     where: {
//       roomState: false
//     },
//     limit: roomLimit
//   }).then(function (roomsFound) {
    
//   });
// };

// Rooms helper method to add to end of game queue
roomsHelper.enqueueToPlay = function (data) {
  // Get the callback
  var callback = data.callback;
  delete data.callback;

  // Ensure userID/playerID can join
  var canJoin = this.canJoinMatchmaking({
    userID: data.userID,
    avatarID: data.avatarID
  });

  // Result to return to player
  var result = {};

  // If the avatar can join, continue to add
  if (canJoin) {
    // Add player to end of linked list
    var added = waitingForGame.addToBack(data);
    // Print the queue
    waitingForGame.print();
    // If there are 2 players in queue, pair them
    if (Object.keys(waitingForGame.nodes).length === 2) {
      this.pairPlayers([
        [
          waitingForGame.head.val,
          waitingForGame.tail.val
        ]
      ]);
    }

    // Add added-to-room bool
    result.inRoomQueue = added;
  } else {
    // Could not join matchmaking
    result.tooManyGames = true;
  }

  // Invoke callback
  callback(result);
};

// Rooms helper check if a avatarID/userID combo can
// join join matchmaking
roomsHelper.canJoinMatchmaking = function (data) {
  // Get userID and avatarID
  var userID = data.userID;
  var avatarID = data.avatarID;

  // Lookup avatar/userID combo
  return avatarsTable.find({
    where: {
      userID: userID,
      id: avatarID
    }
  }).then(function (avatarFound) {
    // If avatar was found
    if (avatarFound) {
      // Ensure avatar is in at most 3 rooms
      return roomsTable.findAll({
        where: {
          $or: [
            {
              avatar1_id: avatarID,
              roomState: 0
            },
            {
              avatar2_id: avatarID,
              roomState: 0
            }
          ]}
      }).then(function (roomsFound) {
        // If there were less than 3 rooms found
        if (roomsFound.length < 3) {
          // Avatar can join matchmaking
          return true;
        }
        // The player is in 3 rooms
        return false;
      });
    } else {
      // Avatar doesn't exist, return false
      return false;
    }
  });
};

// Rooms helper method to remove tuples from queue
roomsHelper.pairPlayers = function (pairs) {
  // Iterate over all pairs
  for (var i = 0; i < pairs.length; ++i) {
    // Get pair
    var pair = pairs[i];
    // Get avatar 1 and avatar 2 IDs
    // var avatar1_id = pair[0].avatarID;
    // var avatar2_id = pair[1].avatarID;
    // Create room for both avatars
    this.addRoom(pair[0], pair[1]).then(function (roomID) {
      // Set socket data
      var socketData = {
        userIDs: [pair[0].userID, pair[1].userID],
        avatarIDs: [pair[0].avatarID, pair[1].avatarID],
        roomID: roomID
      };
      // Handoff to socket helper
      socketHelper.clientJoinRoom(socketData, 
        roomsHelper.getRoomData);
    });
  }
};

// Rooms helper method to create a room between 2 avatars
roomsHelper.addRoom = function (player1, player2) {
  // Get player data
  var avatar1_id = player1.avatarID;
  var avatar2_id = player2.avatarID;
  var avatar1_userID = player1.userID;
  var avatar2_userID = player2.userID;

  // Expect that both avatar IDs exist
  return avatarsTable.findAll({
    where: {
      id: {
        $in: [avatar1_id, avatar2_id]
      }
    }
  }).then(function (avatarIDs) {
    // If there are exactly 2 avatarIDs and their userIDs
    // aren't equal
    if (avatarIDs.length === 2
      && (avatarIDs[0].dataValues.userID
        !== avatarIDs[1].dataValues.userID)) {
      // Check if the pair already exists
      return roomsTable.findAll({
        where: {
          avatar1_id: {
            $in: [avatar1_id, avatar2_id]
          },
          avatar2_id: {
            $in: [avatar1_id, avatar2_id]
          }
        }
      }).then(function (rooms) {
        // If no rooms were found
        if (rooms.length === 0) {
          // Make room
          return roomsTable.create({
            // Avatar 1 ID(first turn)
            avatar1_id: avatar1_id,
            // Avatar 2 (second turn)
            avatar2_id: avatar2_id,
            // Avatar 1 userID
            avatar1_userID: avatar1_userID,
            // Avatar 2 userID
            avatar2_userID: avatar2_userID
          }).then(function (roomCreated) {
            // If the room was created successfully
            if (roomCreated) {
              // Remove both players from queue
              waitingForGame.removeByAvatarID(avatar1_id);
              waitingForGame.removeByAvatarID(avatar2_id);

              // Return roomCreated id
              return roomCreated.dataValues.id;
            }
          });
        } else {
          // Players are already playing (or game hasn't been judged)
          console.log('\n\nPAIRING ERROR: ALREADY PLAYING\n\n');
        }
      });
    } else {
      // Both IDs weren't found
      console.log('\n\nPAIRING ERROR: BOTH IDs NOT FOUND\n\n\tOR'
        + '\n\nPlAYERS ARE THE SAME\n\n');
    }
  });
};

// Rooms helper that gets rooms to every avatar in a room
roomsHelper.getAllRooms = function (data) {
  // Get array of all avatars
  var avatarIDs = Object.keys(data.avatars);
  // Get all rooms associated with avatars
  return roomsTable.findAll({
    where: {
      $or: [
        {
          avatar1_id: {
            $in: avatarIDs
          }
        },
        {
          avatar2_id: {
            $in: avatarIDs
          }
        }
      ]
    }
  }).then(function (roomsFound) {
    // Iterate over all rooms found
    for (var i = 0; i < roomsFound.length; ++i) {
      // Get current room
      var currRoom = roomsFound[i].dataValues;
      // Get avatar id that we need
      var currAvatarID = currRoom.avatar1_id;
      if (currRoom.avatar2_id in data.avatars) {
        currAvatarID = currRoom.avatar2_id;
      }
      // Add room data
      if (data.avatars[currAvatarID].rooms === undefined) {
        data.avatars[currAvatarID].rooms = {};
      }
      // Add key
      data.avatars[currAvatarID].rooms[currRoom.id] = currRoom;
      // Rename id key to roomID
      var avatarRoom = data.avatars[currAvatarID].rooms[currRoom.id];
      avatarRoom.roomID = avatarRoom.id;
      delete avatarRoom.id;
    }

    // Handoff to messagesHelper
    // return messagesHelper.fetchMessagesForLogin(data);
  });
};

// Rooms helper that gets data about one room
roomsHelper.getRoomData = function (data) {
  // Get data
  var roomID = data.roomID;
  var callback = data.callback || null;

  // Result to send to client
  var result = {};

  // Get room by id
  return roomsTable.find({
    where: {
      id: roomID
    }
  }).then(function (roomFound) {
    // If the room was found
    if (roomID) {
      // Set the room
      result.rooms = {};
      result.rooms[roomID] = roomFound.dataValues;
      var room = result.rooms[roomID];

      // Get avatarIDs
      var avatar1_id = room.avatar1_id;
      var avatar2_id = room.avatar2_id;
      delete room.avatar1_id;
      delete room.avatar2_id;

      // Give avatar1 and avatar2 data to room
      room.avatar1 = {
        avatarID: avatar1_id
      };
      room.avatar2 = {
        avatarID: avatar2_id
      };

      // Get names for avatar IDs
      return avatarsTable.findAll({
        where: {
          id: {
            $in: [avatar1_id, avatar2_id]
          }
        }
      }).then(function (avatarsFound) {
        // If exactly 2 avatars were found
        if (avatarsFound.length === 2) {
          // Associate avatar names with ids
          var avatarA = avatarsFound[0].dataValues;
          var avatarB = avatarsFound[1].dataValues;

          // If avatarA is avatar1
          if (avatarA.id === avatar1_id
            && avatarB.id === avatar2_id) {
            // Set names
            room.avatar1.avatarName = avatarA.avatarName;
            room.avatar2.avatarName = avatarB.avatarName;
          } else if (avatarA.id === avatar2_id
            && avatarB.id === avatar1_id) {
            // avatarB is avatar1
            room.avatar1.avatarName = avatarB.avatarName;
            room.avatar2.avatarName = avatarA.avatarName;
          } else {
            // Avatar names are unknown (you messed up breh)
            room.avatar1.avatarName = 'Unknown';
            room.avatar2.avatarName = 'Unknown';
          }

          // Add messages to the room
          return messagesHelper.fetchMessagesForRoom(roomID)
            .then(function (messages) {
              // Set messages
              result.rooms[roomID].messages = messages;

              // Invoke callback if provided
              if (callback) {
                callback(result);
              } else {
                // Other wise return result
                return result;
              }
            });

        } else {
          // The avatarIDs weren't found, invoke callback
          result.avatarNamesFound = false;
          if (callback) {
            callback(result);
          }
        }
      });

    } else {
      // The room wasn't found, invoke callback
      result.roomFound = false;
      if (callback) {
        callback(result);
      }
    }
  });
};

// Rooms helper send message to room
roomsHelper.sendMessageToRoom = function (data) {
  // Get data from route
  var userID = data.userID;
  var avatarID = data.avatarID;
  var roomID = data.roomID;
  var message = data.message;
  // Get callback
  var callback = data.callback;

  // Result to return to client
  var result = {};

  // Check for room in database
  return roomsTable.find({
    where: {
      id: roomID
    }
  }).then(function (roomFound) {
    // Only continue if the room was found
    if (roomFound) {
      // Only continue if room is open/active
      if (roomFound.dataValues.roomState === 0) {
        // Get avatar 1 or avatar 2
        var avatarNum = 0;
        // If avatar 1
        if (roomFound.dataValues.avatar1_id === avatarID) {
          avatarNum = 1;
        } else if (roomFound.dataValues.avatar2_id === avatarID) {
          // Else if avatar 2
          avatarNum = 2;
        } else {
          // Inform client avatar id wasn't found
          result.foundAvatarID = false;
          return callback(result);
        }

        // Check turn validity
        var turnValid = roomsHelper.checkTurn(avatarNum,
          roomFound.dataValues.turnCount);

        // Continue if turn valid
        if (turnValid) {

          // Add message to database
          return messagesHelper.addMessageToRoom({
            roomID: roomID,
            avatarID: avatarID,
            message: message
          }).then(function (messageCreated) {
            // If the message was created
            if (messageCreated) {
              result.messageData = messageCreated;

              // Check if game needs to close
              var roomState
                = (roomFound.dataValues.turnCount < 5 ? 0 : 1);
              // Update turn count
              return roomFound.update({
                turnCount: roomFound.dataValues.turnCount + 1,
                roomState: roomState
              }).then(function () {

                // Update turn count and invoke callback
                result.newTurnCount = roomFound.dataValues.turnCount;
                callback(result);


                // The code below is used for live socket updates


                // Find which avatar in the room is the opponent's
                var opponentUserID = -1;
                // If the sender is avatar1
                if (roomFound.dataValues.avatar1_userID === userID) {
                  opponentUserID
                    = roomFound.dataValues.avatar2_userID;
                } else if (roomFound.dataValues.avatar2_userID
                  === userID) {
                  // If the sender is avatar2
                  opponentUserID
                    = roomFound.dataValues.avatar1_userID;
                }

                // Get data to handoff to socket helper for
                // live update
                var socketData = {
                  opponentUserID: opponentUserID,
                  roomID: roomID
                };

                // Handoff to socket helper
                socketHelper.clientTurnUpdate(socketData, 
                  roomsHelper.getRoomData);


                // The code below is used to add a room to the
                // rooms to be judged data


                // If the game is over
                if (roomState === 1) {
                  // Add the room to judging
                  judging.addRoom(roomID, roomsHelper.getRoomData);
                }
              });
            } else {
              // Message could not be created for some reason
              result.messageCreationError = false;
              callback(result);
            }
          });
        } else {
          // Turn is invalid
          result.turnValid = false;
          callback(result);
        }
      } else {
        // The room is closed, invoke callback
        result.roomOpen = false;
        callback(result);
      }
    } else {
      // Inform client room wasn't found
      result.roomFound = false;
      callback(result);
    }
  });
};

// Rooms helper check turn
roomsHelper.checkTurn = function (avatarOneOrTwo, turnCount) {
  // Assume turn is invalid
  var turnValid = false;
  // Check if turn is less than 6
  if (turnCount < 6) {
    // Check for valid turns
    if (turnCount % 2 === 0 && avatarOneOrTwo === 1
      || turnCount % 2 === 1 && avatarOneOrTwo === 2) {
      turnValid = true;
    }
  }
  // Return bool
  return turnValid;
};

//                             _       
//                            | |      
//   _____  ___ __   ___  _ __| |_ ___ 
//  / _ \ \/ / '_ \ / _ \| '__| __/ __|
// |  __/>  <| |_) | (_) | |  | |_\__ \
//  \___/_/\_\ .__/ \___/|_|   \__|___/
//           | |                       
//           |_|    

// Export users helpers
module.exports = roomsHelper;
const dotenv = require("dotenv");
dotenv.config();
const jwt = require("jsonwebtoken");
const prisma = require("../configs/databaseConfig");
const {
  sendCustomNotification,
} = require("../controllers/notificationController");
const { io } = require("../../index");
dotenv.config();
const secretKey = process.env.SECRETKEY;
let authenticatedUsers = {};
io.on("connection", async (socket) => {
  socket.emit("helloWithoutJwt", "Welcome to the app. But, you are not an Authenticated user!!");

  const token = socket.handshake.headers.authorization;
  if (!token) {
    socket.emit("errorMessage", "Authentication token is required");
    return
  }
  try {
    const decoded = jwt.verify(token, secretKey);

    socket.userID = decoded.id;
    socket.broadcast.emit("online", { userId: socket.userID });
    
    let user = await prisma.user.findFirst({
      where: {
        id: socket.userID,
      },
    });
    if (!user) {
      return res.status(400).json({ message: "User does not Exist" });
    }

    await prisma.user.update({
      where:
      {
        id: socket.userID
      },
      data:
      {
        onlineStatus: "online"
      }
    })
    socket.username = decoded.firstName;
    authenticatedUsers[socket.userID] = socket;

  } catch (error) {
    console.log("error ---> ", error)
    if (error.message === "jwt expired") {
      socket.emit("errorMessage", "Token Has Expired");

    }
    socket.emit("errorMessage", "Invalid or expired token");
    return;
  }

  socket.emit("helloWithJwt", "Welcome to the app. You are now Authenticated user!");
  socket.on("privateMessage", async ({ recipientId, message, chatId }) => {

    const recipientSocket = authenticatedUsers[recipientId];
    try {
      if (!chatId) {
        socket.emit("errorMessage", "Chat ID doesn't exist");
        return;
      }
      if (chatId.length !== 24) {
        socket.emit("errorMessage", "Invalid Chat ID");
        return;
      }

      const existingChat = await prisma.chat.findFirst({
        where: {
          AND: [
            { id: chatId },
            {
              OR: [
                {
                  AND: [
                    { senderId: socket.userID },
                    { receiverId: recipientId },
                  ],
                },
                {
                  AND: [
                    { senderId: recipientId },
                    { receiverId: socket.userID },
                  ],
                },
              ],
            },
          ],
        },
      });

      if (!existingChat) {
        socket.emit(
          "errorMessage",
          "Chat does not exist or does not involve both users"
        );
        return;
      }

      if (existingChat) {
        chatId = existingChat.id;
      }


      const chatt = await prisma.chat.findFirst({
        where:
        {
          id: existingChat.id,
        },
        include:
        {
          post: true,

        }
      })


      const newChatMessage = await prisma.chatMessages.create({
        data: {
          messageBody: message,
          sender: { connect: { id: socket.userID } },
          receiver: { connect: { id: recipientId } },
          chat: { connect: { id: chatId } },
        },
      });

      if (recipientSocket) {
        recipientSocket.emit("privateMessage", {
          message: newChatMessage
        });
        socket.emit("acknowledgment", {
          message: newChatMessage, chat: chatt
        });


      } else {

        const userWithFirebaseToken = await prisma.user.findFirst({
          where:
          {
            id: recipientId
          },
          select:
          {
            firebaseToken: true
          }
        })

        socket.emit("acknowledgment", {
          message: newChatMessage, chat: chatt
        });


         await sendCustomNotification(                  
           chatt.post.title,
         newChatMessage.messageBody,    
          
             {
              id: newChatMessage.id,
              senderId: newChatMessage.senderId,
              receiverId: newChatMessage.receiverId,
              messageBody: newChatMessage.messageBody,
              createdAt: newChatMessage.createdAt.toString(),
              updatedAt: newChatMessage.updatedAt.toString(),
              read: newChatMessage.read.toString(),
              chatId: newChatMessage.chatId,
             
             },         
          
         userWithFirebaseToken.firebaseToken,  
         );
        
       }

    } catch (error) {
      console.log(error)
      if (error.code === "P2023") {
        console.error("Invalid Id Format");
      }
      socket.emit("errorMessage", "Error saving or sending chat message");
    }
  });

  socket.on("chatOpened", async (body) => {
    if (!body.chatId) {
      socket.emit("errorMessage", "Chat ID is required");
      return;
    }
    if (typeof body.chatId !== "string" || body.chatId.length !== 24) {
      socket.emit("errorMessage", "Invalid Chat ID format");
      return;
    }
    const existingChat = await prisma.chat.findFirst({
      where: {
        AND: [
          { id: body.chatId },
          {
            OR: [
              { senderId: socket.userID },
              { receiverId: socket.userID },
            ],
          },
        ],
      },
    });

    if (!existingChat) {
      socket.emit("errorMessage", "Chat does not exist or does not involve the user");
      return;
    }
    try {
      const messageRead = await prisma.chatMessages.updateMany({
        where:
        {
          chatId: body.chatId,
          receiverId: socket.userID,
          read: false,
        },
        data:
        {
          read: true
        }
      })

      socket.emit("messagesRead", `You have read all ${messageRead.count} new messages.`);
    }
    catch (error) {
    console.log(error)
      socket.emit("errorMessage", "Error making messages as read");
    }
  })

  socket.on("disconnect", async () => {
    socket.broadcast.emit("offline", { userId: socket.userID });

    let user = await prisma.user.findFirst({
      where: {
        id: socket.userID,
      },
    });
    if (!user) {
      return res.status(400).json({ message: "User does not Exist" });
    }

    await prisma.user.update({
      where:
      {
        id: socket.userID
      },
      data:
      {
        onlineStatus: "offline"
      }
    })
    delete authenticatedUsers[socket.userID];
  });
});
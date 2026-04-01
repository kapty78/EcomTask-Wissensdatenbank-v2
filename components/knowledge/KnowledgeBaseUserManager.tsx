"use client"

import React, { useState, useEffect } from "react"
import { getSupabaseClient } from "@/lib/supabase-browser"
import { Database } from "@/supabase/types"
import { Users, X, ChevronDown, Search, Plus } from "lucide-react"

// Type definitions
type KnowledgeBase = {
  id: string
  name: string
  user_id: string
  [key: string]: any
}

type KnowledgeGroup = {
  id: string
  name: string
  user_id: string
  [key: string]: any
}

type UserProfile = {
  id: string
  full_name: string
  email?: string
  [key: string]: any
}

interface KnowledgeBaseUserManagerProps {
  knowledgeBase: KnowledgeBase
  user: any
}

export default function KnowledgeBaseUserManager({
  knowledgeBase,
  user
}: KnowledgeBaseUserManagerProps) {
  const supabase = getSupabaseClient()
  const [groups, setGroups] = useState<KnowledgeGroup[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [availableUsers, setAvailableUsers] = useState<UserProfile[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [showAddUserDropdown, setShowAddUserDropdown] = useState(false)

  useEffect(() => {
    if (knowledgeBase?.id) {
      fetchGroups()
      fetchAllUsers()
    }
  }, [knowledgeBase])

  const fetchGroups = async () => {
    setLoading(true)
    try {
      // 1. Get groups associated with this knowledge base
      const { data: groupData, error: groupError } = await supabase
        .from("knowledge_base_groups")
        .select("group_id")
        .eq("knowledge_base_id", knowledgeBase.id)

      if (groupError) throw groupError

      if (groupData && groupData.length > 0) {
        const groupIds = groupData.map(g => g.group_id)

        // 2. Get group details
        const { data: groups, error: groupsError } = await supabase
          .from("knowledge_groups")
          .select("*")
          .in("id", groupIds)

        if (groupsError) throw groupsError
        setGroups(groups || [])

        // 3. If we have groups, fetch their members
        if (groups && groups.length > 0) {
          await fetchGroupMembers(groups[0].id)
        }
      } else {
        setGroups([])
        setUsers([])
      }
    } catch (err) {
      // console.error("Error fetching knowledge base groups:", err)
    } finally {
      setLoading(false)
    }
  }

  const fetchGroupMembers = async (groupId: string) => {
    try {
      // Get members of this group
      const { data: membersData, error: membersError } = await supabase
        .from("knowledge_group_members")
        .select("user_id")
        .eq("group_id", groupId)

      if (membersError) throw membersError

      if (membersData && membersData.length > 0) {
        const userIds = membersData.map(m => m.user_id)

        // Get user profiles
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("*")
          .in("id", userIds)

        if (profilesError) throw profilesError
        setUsers(profiles || [])
      } else {
        setUsers([])
      }
    } catch (err) {
      // console.error("Error fetching group members:", err)
    }
  }

  const fetchAllUsers = async () => {
    try {
      // Get all users that could potentially be added
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name", { ascending: true })

      if (profilesError) throw profilesError
      setAvailableUsers(profiles || [])
    } catch (err) {
      // console.error("Error fetching available users:", err)
    }
  }

  const createGroup = async (): Promise<string | null> => {
    try {
      // Create a new group for this knowledge base
      // console.log("👥 Creating new group for KB:", knowledgeBase.name);
      const groupName = `${knowledgeBase.name} Group`; // Standardized group name
      const { data: group, error: groupError } = await supabase
        .from("knowledge_groups")
        .insert({
          name: groupName,
          user_id: user.id // The current admin/user creating the group
        })
        .select()
        .single()

      if (groupError) throw groupError;
      if (!group) throw new Error("Group creation failed to return data.");

      // console.log("🔗 Associating group", group.id, "with KB", knowledgeBase.id);
      // Associate this group with the knowledge base
      const { error: associationError } = await supabase
        .from("knowledge_base_groups")
        .insert({
          knowledge_base_id: knowledgeBase.id,
          group_id: group.id
        })

      if (associationError) throw associationError

      // console.log("🔄 Refreshing groups after creation...");
      // Refresh data - fetchGroups will update the 'groups' state
      await fetchGroups();
      return group.id; // Return the ID of the newly created group

    } catch (err) {
      // console.error("❌ Error creating knowledge base group:", err);
      return null; // Indicate failure
    }
  }

  const addUser = async (userId: string) => {
    let targetGroupId: string | null = null;

    try {
        // 1. Determine the target group ID
        if (groups.length === 0) {
            // console.log("🤔 No group found for KB, attempting to create one first...");
            targetGroupId = await createGroup(); // Create group and get its ID
            if (!targetGroupId) {
                // console.error("❌ Failed to create a group, cannot add user.");
                // Optionally show an error message to the user here
                return; 
            }
            // console.log("✅ Group created/ensured, using group ID:", targetGroupId);
        } else {
            // If groups already exist, use the first one.
            // Future enhancement: Allow selecting which group if multiple exist.
            targetGroupId = groups[0].id;
            // console.log("✅ Using existing group ID:", targetGroupId);
        }

      // 2. Add user to the determined group
      // console.log(`➕ Adding user ${userId} to group ${targetGroupId}`);
      const { error } = await supabase
        .from("knowledge_group_members")
        .insert({
          group_id: targetGroupId, // Use the determined group ID
          user_id: userId
        })

      if (error) {
           // Handle potential duplicate entry error gracefully
           if (error.code === '23505') { // PostgreSQL unique violation code
             // console.warn(`🔔 User ${userId} might already be in group ${targetGroupId}.`);
             // Optionally inform the user or just proceed
           } else {
             throw error; // Re-throw other errors
           }
      } else {
         // console.log(`✅ User ${userId} added successfully to group ${targetGroupId}`);
      }

      // 3. Refresh the member list for the UI
      // console.log("🔄 Refreshing member list...");
      await fetchGroupMembers(targetGroupId);
      setShowAddUserDropdown(false); // Close dropdown

    } catch (err) {
      // console.error("❌ Error adding user to knowledge base:", err);
      // Optionally show an error message to the user
    }
  }

  const removeUser = async (userId: string) => {
    if (!groups.length) return

    try {
      // Use the first group associated with this knowledge base
      const groupId = groups[0].id

      // Remove user from group
      const { error } = await supabase
        .from("knowledge_group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", userId)

      if (error) throw error

      // Refresh the member list
      await fetchGroupMembers(groupId)
    } catch (err) {
      // console.error("Error removing user from knowledge base:", err)
    }
  }

  // Filter users not already in the knowledge base
  const filteredUsers = searchQuery
    ? availableUsers.filter(
        user =>
          user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !users.some(existingUser => existingUser.id === user.id)
      )
    : availableUsers.filter(
        user => !users.some(existingUser => existingUser.id === user.id)
      )

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="size-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[#333333] bg-[#1e1e1e] p-6">
      <div className="mb-4">
        <h3 className="mb-2 text-lg font-medium text-white">Benutzer-Berechtigungen</h3>
        <p className="mb-6 text-sm text-gray-400">
          Verwalten Sie hier, welche Benutzer Zugriff auf diese Wissensdatenbank haben und die KI anweisen können, diesen Kontext zu verwenden.
        </p>

        {groups.length === 0 ? (
          <div className="mb-4 rounded-lg border border-dashed border-[#444444] bg-[#242424] p-6 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[#2a2a2a]">
              <Users size={24} className="text-blue-600" />
            </div>
            <p className="mb-3 text-sm text-gray-400">
              Es wurde noch keine Gruppe für diese Wissensdatenbank erstellt.
            </p>
            <button
              onClick={async () => {
                const groupId = await createGroup();
                if (groupId) {
                  // console.log("Group created successfully with ID:", groupId);
                }
              }}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus size={16} className="mr-2 inline-block" />
              Gruppe erstellen
            </button>
          </div>
        ) : (
          <>
            <div className="relative mb-6">
              <div 
                onClick={() => setShowAddUserDropdown(!showAddUserDropdown)}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-[#444444] bg-[#242424] px-4 py-3 hover:border-blue-600/50 hover:bg-[#2a2a2a]"
              >
                <div className="flex items-center">
                  <Users size={18} className="mr-2 text-gray-400" />
                  <span className="text-sm font-medium text-gray-300">Neuen Benutzer hinzufügen</span>
                </div>
                <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${showAddUserDropdown ? 'rotate-180' : ''}`} />
              </div>
              
              {showAddUserDropdown && (
                <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-lg border border-[#444444] bg-[#242424] shadow-lg">
                  <div className="p-3">
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Suche nach Benutzern..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-[#333333] bg-[#1e1e1e] py-2 pl-10 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </div>
                  
                  <div className="max-h-60 overflow-y-auto">
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map(user => (
                        <div
                          key={user.id}
                          onClick={async () => await addUser(user.id)}
                          className="cursor-pointer px-4 py-2.5 text-sm text-white hover:bg-[#333333]"
                        >
                          {user.full_name || user.email || user.id}
                        </div>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-gray-400">
                        Keine weiteren Benutzer verfügbar
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            {/* User list with heading and count */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-medium text-white">Aktuelle Benutzer</h4>
                <span className="rounded-full bg-[#333333] px-2 py-0.5 text-xs text-gray-300">
                  {users.length} {users.length === 1 ? 'Benutzer' : 'Benutzer'}
                </span>
              </div>
              
              <div className="space-y-2">
                {users.length > 0 ? (
                  users.map(user => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between rounded-lg border border-[#333333] bg-[#1e1e1e] px-3 py-2"
                    >
                      <span className="text-sm text-white">
                        {user.full_name || user.email || user.id}
                      </span>
                      <button
                        onClick={() => removeUser(user.id)}
                        className="text-gray-400 hover:text-blue-600"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-[#444444] bg-[#242424] p-4 text-center text-sm text-gray-400">
                    Keine Benutzer haben aktuell Zugriff
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-6 rounded-lg bg-[#242424] p-4">
        <h4 className="mb-2 text-sm font-medium text-white">Über Benutzer-Berechtigungen</h4>
        <p className="text-xs text-gray-400">
          Benutzer mit Zugriff auf diese Wissensdatenbank können die KI anweisen, den Inhalt dieser
          Datenbank als Kontext zu verwenden. Nur Benutzer mit Berechtigungen können auf die Inhalte
          zugreifen.
        </p>
      </div>
    </div>
  )
} 